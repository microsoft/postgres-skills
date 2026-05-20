"""
PostgreSQL Agent Skills Evaluation Pipeline
Measures skill quality via control vs test group comparison.

Usage:
    python evals/pipeline.py [--challenges PATH] [--output PATH] [--model MODEL]
                             [--concurrency N] [--no-judge] [--dry-run]
"""
import hashlib
import json
import math
import os
import random
import subprocess
import sys
import time
import threading
import yaml
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))
from matchers import PatternMatcher, HallucinationDetector, SQLSyntaxValidator, TokenBudgetValidator
from judges import SkillJudge

EVALS_DIR = Path(__file__).resolve().parent
DEFAULT_CHALLENGES_PATH = EVALS_DIR / "challenges" / "challenges.yaml"
DEFAULT_OUTPUT_DIR = EVALS_DIR / "results"
DEFAULT_SKILLS_ROOT = EVALS_DIR.parents[1]


# ─── Data Models ────────────────────────────────────────────────────────────

@dataclass
class Challenge:
    id: str
    task: str
    difficulty: str
    target_skill: str
    platform_scope: str
    expected_activation: bool
    expected_patterns: list[str] = field(default_factory=list)
    anti_patterns: list[str] = field(default_factory=list)
    notes: str = ""


@dataclass
class EvalResult:
    challenge_id: str
    group: str  # "control" or "test"
    model: str
    output: str
    pattern_match: dict
    hallucinations: list[dict]
    sql_validity: dict
    token_budget: dict
    activation_correct: bool
    judge_verdict: Optional[dict] = None
    latency_ms: float = 0.0
    timestamp: str = ""


@dataclass
class SkillMetrics:
    skill_id: str
    true_positives: int = 0   # correctly activated
    false_positives: int = 0  # activated when shouldn't
    false_negatives: int = 0  # not activated when should
    true_negatives: int = 0   # correctly not activated
    pattern_scores: list[float] = field(default_factory=list)
    judge_scores: list[float] = field(default_factory=list)
    hallucination_count: int = 0


# ─── Statistical Analysis ────────────────────────────────────────────────────

class StatisticalAnalyzer:
    """Industry-standard delta metrics: Cohen's d, bootstrap CI, Wilcoxon."""

    @staticmethod
    def cohens_d(test_scores: list[float], control_scores: list[float]) -> float:
        """Compute Cohen's d effect size (pooled std deviation normalization)."""
        if len(test_scores) < 2 or len(control_scores) < 2:
            return 0.0
        mean_t = sum(test_scores) / len(test_scores)
        mean_c = sum(control_scores) / len(control_scores)
        var_t = sum((x - mean_t) ** 2 for x in test_scores) / (len(test_scores) - 1)
        var_c = sum((x - mean_c) ** 2 for x in control_scores) / (len(control_scores) - 1)
        pooled_std = math.sqrt((var_t + var_c) / 2)
        if pooled_std == 0:
            return 0.0
        return (mean_t - mean_c) / pooled_std

    @staticmethod
    def cohens_d_interpretation(d: float) -> str:
        """Standard interpretation of Cohen's d magnitude."""
        abs_d = abs(d)
        if abs_d < 0.2:
            return "negligible"
        elif abs_d < 0.5:
            return "small"
        elif abs_d < 0.8:
            return "medium"
        else:
            return "large"

    @staticmethod
    def bootstrap_ci(
        test_scores: list[float],
        control_scores: list[float],
        n_bootstrap: int = 1000,
        confidence: float = 0.95,
        seed: int = 42,
    ) -> dict:
        """Bootstrap confidence interval for mean delta."""
        if not test_scores or not control_scores:
            return {"lower": 0.0, "upper": 0.0, "mean": 0.0, "significant": False}

        rng = random.Random(seed)
        deltas = []
        n_test = len(test_scores)
        n_control = len(control_scores)

        for _ in range(n_bootstrap):
            boot_test = [rng.choice(test_scores) for _ in range(n_test)]
            boot_control = [rng.choice(control_scores) for _ in range(n_control)]
            boot_delta = sum(boot_test) / n_test - sum(boot_control) / n_control
            deltas.append(boot_delta)

        deltas.sort()
        alpha = 1 - confidence
        lower_idx = int(alpha / 2 * n_bootstrap)
        upper_idx = int((1 - alpha / 2) * n_bootstrap)

        lower = deltas[lower_idx]
        upper = deltas[min(upper_idx, n_bootstrap - 1)]
        mean_delta = sum(deltas) / len(deltas)

        # Significant if CI doesn't cross zero
        significant = (lower > 0) or (upper < 0)

        return {
            "lower": round(lower, 4),
            "upper": round(upper, 4),
            "mean": round(mean_delta, 4),
            "significant": significant,
        }

    @staticmethod
    def wilcoxon_signed_rank(paired_diffs: list[float]) -> dict:
        """Wilcoxon signed-rank test for paired differences (no scipy dependency)."""
        # Remove zeros
        diffs = [d for d in paired_diffs if d != 0]
        n = len(diffs)
        if n < 5:
            return {"W_statistic": 0, "p_value_approx": 1.0, "significant": False, "n_pairs": n}

        # Rank absolute differences
        abs_diffs = [(abs(d), i) for i, d in enumerate(diffs)]
        abs_diffs.sort(key=lambda x: x[0])

        ranks = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j < n and abs_diffs[j][0] == abs_diffs[i][0]:
                j += 1
            avg_rank = (i + j + 1) / 2  # 1-based average rank for ties
            for k in range(i, j):
                ranks[abs_diffs[k][1]] = avg_rank
            i = j

        # Sum positive and negative ranks
        W_plus = sum(ranks[i] for i in range(n) if diffs[i] > 0)
        W_minus = sum(ranks[i] for i in range(n) if diffs[i] < 0)
        W = min(W_plus, W_minus)

        # Normal approximation for p-value (valid for n >= 10)
        mean_W = n * (n + 1) / 4
        std_W = math.sqrt(n * (n + 1) * (2 * n + 1) / 24)
        if std_W == 0:
            z = 0
        else:
            z = (W - mean_W) / std_W

        # Two-tailed p-value approximation using standard normal CDF
        p_value = 2 * StatisticalAnalyzer._normal_cdf(z)

        return {
            "W_statistic": round(W, 2),
            "W_plus": round(W_plus, 2),
            "W_minus": round(W_minus, 2),
            "z_score": round(z, 3),
            "p_value_approx": round(p_value, 4),
            "significant": p_value < 0.05,
            "n_pairs": n,
        }

    @staticmethod
    def _normal_cdf(z: float) -> float:
        """Approximate standard normal CDF (Abramowitz & Stegun)."""
        if z < -6:
            return 0.0
        if z > 6:
            return 1.0
        a1 = 0.254829592
        a2 = -0.284496736
        a3 = 1.421413741
        a4 = -1.453152027
        a5 = 1.061405429
        p = 0.3275911
        sign = 1 if z >= 0 else -1
        x = abs(z) / math.sqrt(2)
        t = 1.0 / (1.0 + p * x)
        y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x * x)
        return 0.5 * (1.0 + sign * y)

    @staticmethod
    def paired_winrate(winrate_results: list[dict]) -> dict:
        """Aggregate paired win-rate results."""
        wins = sum(1 for r in winrate_results if r.get("winner") == "B_wins")
        losses = sum(1 for r in winrate_results if r.get("winner") == "A_wins")
        ties = sum(1 for r in winrate_results if r.get("winner") == "tie")
        total = len(winrate_results)
        if total == 0:
            return {"win_rate": 0, "loss_rate": 0, "tie_rate": 0, "total": 0, "net_wins": 0}
        return {
            "win_rate": round(wins / total, 3),
            "loss_rate": round(losses / total, 3),
            "tie_rate": round(ties / total, 3),
            "wins": wins,
            "losses": losses,
            "ties": ties,
            "total": total,
            "net_wins": wins - losses,
        }


# ─── Pipeline ───────────────────────────────────────────────────────────────

class EvalPipeline:
    """Main evaluation pipeline orchestrator."""

    def __init__(self, challenges_path: str, skills_root: str, output_dir: str):
        self.challenges_path = Path(challenges_path)
        self.skills_root = Path(skills_root)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.matcher = PatternMatcher()
        self.hallucination_detector = HallucinationDetector()
        self.sql_validator = SQLSyntaxValidator()
        self.token_validator = TokenBudgetValidator()
        self.judge = SkillJudge()

        self.challenges: list[Challenge] = []
        self.results: list[EvalResult] = []
        self.skill_metrics: dict[str, SkillMetrics] = {}
        self.winrate_results: list[dict] = []  # Paired win-rate verdicts
        self._judge_agent_fn = None  # Set during run() for judge LLM calls
        self._calibration_mode = False  # When True, trims skill to task-relevant sections
        self._model = "gpt-4o-mini"  # Set during run()
        self._judge_model: Optional[str] = None  # Set during run(); falls back to agent model
        self._lock = threading.Lock()  # Guards shared state during parallel execution

    def _get_provenance(self) -> dict:
        """Generate provenance metadata for reproducibility."""
        # Pipeline commit SHA
        try:
            commit = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=str(self.skills_root),
                stderr=subprocess.DEVNULL, text=True
            ).strip()
        except Exception:
            commit = "unknown"

        # Challenges file hash
        try:
            challenges_content = self.challenges_path.read_bytes()
            challenges_sha = hashlib.sha256(challenges_content).hexdigest()[:12]
        except Exception:
            challenges_sha = "unknown"

        # Skills manifest hash
        manifest_path = self.skills_root / ".skills.json"
        try:
            manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()[:12]
        except Exception:
            manifest_sha = "unknown"

        return {
            "pipeline_commit": commit,
            "challenges_sha256": challenges_sha,
            "model_id": self._model,
            "judge_model_id": self._judge_model or self._model,
            "calibration_mode": self._calibration_mode,
            "total_challenges": len(self.challenges),
        }

    def load_challenges(self) -> list[Challenge]:
        """Load challenge definitions from YAML."""
        with open(self.challenges_path) as f:
            data = yaml.safe_load(f)

        self.challenges = [
            Challenge(
                id=c["id"],
                task=c["task"],
                difficulty=c["difficulty"],
                target_skill=c["target_skill"],
                platform_scope=c["platform_scope"],
                expected_activation=c["expected_activation"],
                expected_patterns=c.get("expected_patterns", []),
                anti_patterns=c.get("anti_patterns", []),
                notes=c.get("notes", ""),
            )
            for c in data["challenges"]
        ]
        print(f"Loaded {len(self.challenges)} challenges")
        return self.challenges

    def load_skill(self, skill_path: str, task: str = "", calibration_mode: bool = False) -> str:
        """Load a skill/reference file content. Only trims in calibration mode."""
        # New flat structure: skill_path is like "skills/references/postgresql-advanced-indexing"
        # Try as .md file first, then as directory with SKILL.md
        md_path = self.skills_root / f"{skill_path}.md"
        if md_path.exists():
            content = md_path.read_text(encoding="utf-8")
        elif (self.skills_root / skill_path / "SKILL.md").exists():
            content = (self.skills_root / skill_path / "SKILL.md").read_text(encoding="utf-8")
        elif skill_path in ("skills/references", "skills"):
            root_skill = self.skills_root / "skills" / "SKILL.md"
            if root_skill.exists():
                content = root_skill.read_text(encoding="utf-8")
            else:
                return ""
        else:
            return ""

        # Only trim in calibration mode (production loads full skill)
        if calibration_mode and task and len(content) > 2000:
            content = self._extract_relevant_sections(content, task)
        return content

    def _extract_relevant_sections(self, content: str, task: str) -> str:
        """Extract sections most relevant to the task, keeping total under ~1500 tokens."""
        # Always keep: Key Facts table, Anti-Hallucination Rules, Decision Matrix
        # Selectively include: Gotchas that match task keywords
        lines = content.split("\n")
        task_lower = task.lower()
        task_words = set(task_lower.split())

        # Split into sections by ## headers
        sections = []
        current_section = {"header": "", "lines": []}
        for line in lines:
            if line.startswith("## "):
                if current_section["lines"]:
                    sections.append(current_section)
                current_section = {"header": line, "lines": [line]}
            else:
                current_section["lines"].append(line)
        if current_section["lines"]:
            sections.append(current_section)

        # Priority sections (always include)
        priority_headers = {"key facts", "anti-hallucination", "decision matrix", "decision"}
        # Secondary sections (include if they match task keywords)
        always_include = []
        conditional_include = []

        for sec in sections:
            header_lower = sec["header"].lower()
            if any(p in header_lower for p in priority_headers):
                always_include.append(sec)
            elif "critical gotcha" in header_lower or "gotcha" in header_lower:
                # Filter gotchas to only relevant ones
                relevant_lines = [sec["lines"][0]]  # header
                for line in sec["lines"][1:]:
                    line_lower = line.lower()
                    if any(w in line_lower for w in task_words if len(w) > 3):
                        relevant_lines.append(line)
                    elif line.startswith(("1.", "2.", "3.", "4.", "5.", "6.")):
                        relevant_lines.append(line)
                if len(relevant_lines) > 1:
                    always_include.append({"header": sec["header"], "lines": relevant_lines})
            elif not sec["header"]:
                # Frontmatter/preamble - always include
                always_include.append(sec)
            else:
                # Check if section is relevant to task
                section_text = " ".join(sec["lines"]).lower()
                overlap = sum(1 for w in task_words if len(w) > 3 and w in section_text)
                if overlap >= 2:
                    conditional_include.append((overlap, sec))

        # Build output: always sections + top conditional sections (within budget)
        output_lines = []
        for sec in always_include:
            output_lines.extend(sec["lines"])

        # Add conditional sections sorted by relevance, up to ~1500 tokens
        conditional_include.sort(key=lambda x: x[0], reverse=True)
        current_chars = sum(len(l) for l in output_lines)
        for _, sec in conditional_include:
            sec_chars = sum(len(l) for l in sec["lines"])
            if current_chars + sec_chars < 6000:  # ~1500 tokens
                output_lines.extend(sec["lines"])
                current_chars += sec_chars

        result = "\n".join(output_lines)
        return result if result.strip() else content  # fallback to full if extraction failed

    def run_challenge(self, challenge: Challenge, agent_fn, group: str, model: str) -> EvalResult:
        """Run a single challenge against the agent function."""
        start = time.time()

        # Call agent (control = no skill context, test = with skill context)
        skill_context = ""
        if group == "test":
            skill_context = self.load_skill(challenge.target_skill, task=challenge.task, calibration_mode=self._calibration_mode)

        output = agent_fn(challenge.task, skill_context, model)
        latency_ms = (time.time() - start) * 1000

        # Evaluate patterns
        pattern_result = self.matcher.evaluate(
            output,
            challenge.expected_patterns,
            challenge.anti_patterns
        )

        # Check hallucinations (scoped by platform context)
        hallucinations = self.hallucination_detector.check(output, challenge.platform_scope)

        # SQL validation
        sql_result = self.sql_validator.validate(output)

        # Token budget
        tier = "azure-ai" if any(k in challenge.target_skill for k in ("azure-ai", "genai-patterns")) \
            else "azure-standard" if "azure-" in challenge.target_skill \
            else "generic"
        token_result = self.token_validator.check(output, tier)

        # Activation correctness
        activation_correct = True
        if challenge.expected_activation and not pattern_result.passed:
            activation_correct = False
        if not challenge.expected_activation and pattern_result.score > 0.5:
            activation_correct = False

        # LLM-as-judge quality scoring (only for positive challenges with real agent)
        judge_verdict = None
        if challenge.expected_activation and self._judge_agent_fn and output and not output.startswith("[MOCK]"):
            def _call_judge_llm(prompt: str) -> str:
                return self._judge_agent_fn(prompt, "", self._judge_model or self._model)
            verdict = self.judge.judge_quality(
                task=challenge.task,
                output=output,
                skill_name=challenge.target_skill,
                call_llm_fn=_call_judge_llm,
            )
            judge_verdict = {
                "score": verdict.score,
                "passed": verdict.passed,
                "reasoning": verdict.reasoning,
                "criteria_scores": verdict.criteria_scores,
            }

        result = EvalResult(
            challenge_id=challenge.id,
            group=group,
            model=model,
            output=output,
            pattern_match=asdict(pattern_result) if hasattr(pattern_result, '__dict__') else {
                "passed": pattern_result.passed,
                "score": pattern_result.score,
                "matched_patterns": pattern_result.matched_patterns,
                "missing_patterns": pattern_result.missing_patterns,
                "triggered_anti_patterns": pattern_result.triggered_anti_patterns,
            },
            hallucinations=hallucinations,
            sql_validity=sql_result,
            token_budget=token_result,
            activation_correct=activation_correct,
            judge_verdict=judge_verdict,
            latency_ms=latency_ms,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

        with self._lock:
            self.results.append(result)
        return result

    def compute_skill_metrics(self) -> dict[str, SkillMetrics]:
        """Compute per-skill confusion matrix from results."""
        metrics: dict[str, SkillMetrics] = {}

        for challenge in self.challenges:
            skill = challenge.target_skill
            if skill not in metrics:
                metrics[skill] = SkillMetrics(skill_id=skill)

            # Find test-group result for this challenge
            result = next(
                (r for r in self.results if r.challenge_id == challenge.id and r.group == "test"),
                None
            )
            if not result:
                continue

            m = metrics[skill]
            if challenge.expected_activation:
                if result.activation_correct:
                    m.true_positives += 1
                else:
                    m.false_negatives += 1
            else:
                if result.activation_correct:
                    m.true_negatives += 1
                else:
                    m.false_positives += 1

            m.pattern_scores.append(result.pattern_match.get("score", 0.0))
            if result.judge_verdict and "score" in result.judge_verdict:
                m.judge_scores.append(result.judge_verdict["score"])
            m.hallucination_count += len(result.hallucinations)

        self.skill_metrics = metrics
        return metrics

    def generate_report(self) -> dict:
        """Generate final evaluation report."""
        metrics = self.compute_skill_metrics()

        # Aggregate scores
        total_tp = sum(m.true_positives for m in metrics.values())
        total_fp = sum(m.false_positives for m in metrics.values())
        total_fn = sum(m.false_negatives for m in metrics.values())
        total_tn = sum(m.true_negatives for m in metrics.values())
        total_hallucinations = sum(m.hallucination_count for m in metrics.values())

        precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
        recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        # Compare control vs test using JUDGE scores (semantic quality)
        # Falls back to pattern scores if judge wasn't used
        control_judge_scores = [
            r.judge_verdict["score"] for r in self.results
            if r.group == "control" and r.judge_verdict and "score" in r.judge_verdict
        ]
        test_judge_scores = [
            r.judge_verdict["score"] for r in self.results
            if r.group == "test" and r.judge_verdict and "score" in r.judge_verdict
        ]

        # Pattern-based delta (legacy)
        control_pattern_scores = [
            r.pattern_match.get("score", 0) for r in self.results if r.group == "control"
        ]
        test_pattern_scores = [
            r.pattern_match.get("score", 0) for r in self.results if r.group == "test"
        ]
        avg_control_pattern = sum(control_pattern_scores) / len(control_pattern_scores) if control_pattern_scores else 0
        avg_test_pattern = sum(test_pattern_scores) / len(test_pattern_scores) if test_pattern_scores else 0

        # Use judge scores for delta if available, otherwise fall back to pattern
        if control_judge_scores and test_judge_scores:
            avg_control = sum(control_judge_scores) / len(control_judge_scores)
            avg_test = sum(test_judge_scores) / len(test_judge_scores)
            delta_method = "judge"
        else:
            avg_control = avg_control_pattern
            avg_test = avg_test_pattern
            delta_method = "pattern"
        delta = avg_test - avg_control

        # ─── Statistical Analysis (Industry-Standard) ────────────────────────
        stats = StatisticalAnalyzer()

        # Cohen's d (normalized effect size)
        if delta_method == "judge":
            cohens_d = stats.cohens_d(test_judge_scores, control_judge_scores)
        else:
            cohens_d = stats.cohens_d(test_pattern_scores, control_pattern_scores)

        # Bootstrap 95% CI
        if delta_method == "judge":
            bootstrap_ci = stats.bootstrap_ci(test_judge_scores, control_judge_scores)
        else:
            bootstrap_ci = stats.bootstrap_ci(test_pattern_scores, control_pattern_scores)

        # Wilcoxon signed-rank on paired differences (same challenge, test - control)
        paired_diffs = []
        for challenge in self.challenges:
            if not challenge.expected_activation:
                continue
            control_r = next(
                (r for r in self.results if r.challenge_id == challenge.id and r.group == "control"
                 and r.judge_verdict and "score" in r.judge_verdict), None
            )
            test_r = next(
                (r for r in self.results if r.challenge_id == challenge.id and r.group == "test"
                 and r.judge_verdict and "score" in r.judge_verdict), None
            )
            if control_r and test_r:
                paired_diffs.append(test_r.judge_verdict["score"] - control_r.judge_verdict["score"])

        wilcoxon = stats.wilcoxon_signed_rank(paired_diffs)

        # Paired win-rate
        winrate_summary = stats.paired_winrate(self.winrate_results)

        # Segmented win-rates (by platform scope and difficulty)
        challenge_map = {c.id: c for c in self.challenges}
        azure_winrate_items = [
            w for w in self.winrate_results
            if challenge_map.get(w.get("challenge_id"), Challenge("","","","","",False)).platform_scope == "azure-postgresql"
        ]
        generic_winrate_items = [
            w for w in self.winrate_results
            if challenge_map.get(w.get("challenge_id"), Challenge("","","","","",False)).platform_scope == "generic"
        ]
        hard_winrate_items = [
            w for w in self.winrate_results
            if challenge_map.get(w.get("challenge_id"), Challenge("","","","","",False)).difficulty in ("hard", "medium")
        ]

        # Difficulty-weighted win rate: hard=3x, medium=2x, easy=1x
        difficulty_weights = {"hard": 3.0, "medium": 2.0, "easy": 1.0}
        weighted_wins = 0.0
        weighted_losses = 0.0
        weighted_ties = 0.0
        weighted_total = 0.0
        for w in self.winrate_results:
            cid = w.get("challenge_id", "")
            c = challenge_map.get(cid)
            weight = difficulty_weights.get(c.difficulty, 1.0) if c else 1.0
            weighted_total += weight
            if w.get("winner") == "B_wins":
                weighted_wins += weight
            elif w.get("winner") == "A_wins":
                weighted_losses += weight
            else:
                weighted_ties += weight

        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "provenance": self._get_provenance(),
            "summary": {
                "total_challenges": len(self.challenges),
                "total_results": len(self.results),
                "precision": round(precision, 3),
                "recall": round(recall, 3),
                "f1_score": round(f1, 3),
                "hallucination_rate": total_hallucinations,
                "false_activation_rate": round(total_fp / (total_fp + total_tn), 3) if (total_fp + total_tn) > 0 else 0,
            },
            "delta": {
                "method": delta_method,
                "control_avg_score": round(avg_control, 3),
                "test_avg_score": round(avg_test, 3),
                "improvement": round(delta, 3),
                "pattern_delta": round(avg_test_pattern - avg_control_pattern, 3),
                "cohens_d": round(cohens_d, 3),
                "cohens_d_interpretation": StatisticalAnalyzer.cohens_d_interpretation(cohens_d),
                "bootstrap_95_ci": bootstrap_ci,
                "wilcoxon_test": wilcoxon,
                "paired_winrate": winrate_summary,
                "segmented_winrate": {
                    "azure": stats.paired_winrate(azure_winrate_items),
                    "generic": stats.paired_winrate(generic_winrate_items),
                    "hard_medium": stats.paired_winrate(hard_winrate_items),
                },
                "weighted_winrate": {
                    "win_rate": round(weighted_wins / weighted_total, 3) if weighted_total else 0,
                    "loss_rate": round(weighted_losses / weighted_total, 3) if weighted_total else 0,
                    "tie_rate": round(weighted_ties / weighted_total, 3) if weighted_total else 0,
                    "weighting": "hard=3x, medium=2x, easy=1x",
                },
            },
            "per_skill": {
                skill: {
                    "tp": m.true_positives,
                    "fp": m.false_positives,
                    "fn": m.false_negatives,
                    "tn": m.true_negatives,
                    "avg_pattern_score": round(sum(m.pattern_scores) / len(m.pattern_scores), 3) if m.pattern_scores else 0,
                    "avg_judge_score": round(sum(m.judge_scores) / len(m.judge_scores), 3) if m.judge_scores else None,
                    "hallucinations": m.hallucination_count,
                }
                for skill, m in metrics.items()
            },
            "scoring_rubric": {
                "syntax_accuracy": "100% required",
                "tool_selection": ">90% required",
                "token_efficiency": "pass/fail per tier",
                "hallucination_rate": "0% required",
                "activation_precision": "<20% false activations",
            }
        }

        return report

    def save_results(self, report: dict):
        """Save results and report to output directory."""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

        # Save report
        report_path = self.output_dir / f"report_{timestamp}.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2, default=str)

        # Save raw results
        results_path = self.output_dir / f"results_{timestamp}.json"
        with open(results_path, "w") as f:
            json.dump([asdict(r) for r in self.results], f, indent=2, default=str)

        # Always write latest.json (stable path for CI commit-back)
        latest_path = self.output_dir / "latest.json"
        with open(latest_path, "w") as f:
            json.dump(report, f, indent=2, default=str)

        print(f"Report saved: {report_path}")
        print(f"Latest saved: {latest_path}")
        print(f"Results saved: {results_path}")
        return report_path, results_path

    def _run_single_challenge(self, challenge: Challenge, agent_fn, model: str, index: int, total: int):
        """Run control + test + judge for one challenge. Thread-safe."""
        label = f"[{index}/{total}] {challenge.id} ({challenge.difficulty})"

        # Control group (no skill)
        control_result = self.run_challenge(challenge, agent_fn, "control", model)

        # Test group (with skill)
        test_result = self.run_challenge(challenge, agent_fn, "test", model)

        # Paired win-rate comparison
        if (challenge.expected_activation and self._judge_agent_fn
                and control_result.output and test_result.output
                and not control_result.output.startswith("[MOCK]")):
            def _call_winrate_llm(prompt: str) -> str:
                return self._judge_agent_fn(prompt, "", self._judge_model or self._model)
            verdict = self.judge.judge_paired_winrate(
                task=challenge.task,
                control_output=control_result.output,
                test_output=test_result.output,
                call_llm_fn=_call_winrate_llm,
            )
            verdict["challenge_id"] = challenge.id
            verdict["target_skill"] = challenge.target_skill
            with self._lock:
                self.winrate_results.append(verdict)

        print(f"  {label} done")

    def run(self, agent_fn, model: str = "gpt-4o-mini", judge_model: Optional[str] = None, use_judge: bool = True, concurrency: int = 5, calibration_mode: bool = False):
        """Execute full pipeline: control + test for all challenges."""
        self.load_challenges()
        self._calibration_mode = calibration_mode
        self._model = model
        self._judge_model = judge_model

        # Wire up judge agent function (reuses the agent provider with the judge model when configured)
        if use_judge and agent_fn != mock_agent:
            self._judge_agent_fn = agent_fn
        else:
            self._judge_agent_fn = None

        judge_status = "enabled (LLM-as-judge)" if self._judge_agent_fn else "disabled (pattern-only)"
        mode = f"parallel (concurrency={concurrency})" if concurrency > 1 else "sequential"
        print(f"\n{'='*60}")
        print(f"Running eval pipeline: {len(self.challenges)} challenges x 2 groups")
        print(f"Model: {model}")
        print(f"Judge model: {self._judge_model or self._model}")
        print(f"Judge: {judge_status}")
        print(f"Execution: {mode}")
        print(f"{'='*60}\n")

        total = len(self.challenges)
        start_time = time.time()

        if concurrency > 1:
            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures = {
                    executor.submit(
                        self._run_single_challenge, challenge, agent_fn, model, i + 1, total
                    ): challenge
                    for i, challenge in enumerate(self.challenges)
                }
                for future in as_completed(futures):
                    challenge = futures[future]
                    try:
                        future.result()
                    except Exception as e:
                        print(f"  ERROR on {challenge.id}: {e}")
        else:
            for i, challenge in enumerate(self.challenges):
                self._run_single_challenge(challenge, agent_fn, model, i + 1, total)

        elapsed = time.time() - start_time
        print(f"\nCompleted in {elapsed:.1f}s ({elapsed/total:.1f}s per challenge)")

        # Generate and save report
        report = self.generate_report()
        self.save_results(report)

        # Print summary
        print(f"\n{'='*60}")
        print("RESULTS SUMMARY")
        print(f"{'='*60}")
        print(f"Precision: {report['summary']['precision']}")
        print(f"Recall:    {report['summary']['recall']}")
        print(f"F1 Score:  {report['summary']['f1_score']}")
        print(f"Delta ({report['delta']['method']}): {report['delta']['improvement']}")
        if report['delta']['method'] == 'judge':
            print(f"Delta (pattern, legacy): {report['delta']['pattern_delta']}")
        print(f"Cohen's d: {report['delta']['cohens_d']} ({report['delta']['cohens_d_interpretation']})")
        ci = report['delta']['bootstrap_95_ci']
        sig_marker = "*" if ci['significant'] else ""
        print(f"95% CI: [{ci['lower']}, {ci['upper']}]{sig_marker}")
        wr = report['delta']['paired_winrate']
        if wr['total'] > 0:
            print(f"Win Rate: {wr['win_rate']:.1%} wins, {wr['loss_rate']:.1%} losses, {wr['tie_rate']:.1%} ties ({wr['total']} matchups)")
        wilcox = report['delta']['wilcoxon_test']
        if wilcox['n_pairs'] >= 5:
            wilcox_sig = " (SIGNIFICANT)" if wilcox['significant'] else " (not significant)"
            print(f"Wilcoxon: W={wilcox['W_statistic']}, p={wilcox['p_value_approx']}{wilcox_sig}")
        print(f"Hallucinations: {report['summary']['hallucination_rate']}")
        far = report['summary']['false_activation_rate']
        print(f"False Activation Rate: {far:.1%}")

        # Segmented win-rates
        seg = report['delta'].get('segmented_winrate', {})
        if seg:
            print(f"\n{'='*60}")
            print("SEGMENTED WIN RATES")
            print(f"{'='*60}")
            for scope, sr in seg.items():
                if sr and sr.get('total', 0) > 0:
                    print(f"  {scope:12s}: {sr['win_rate']:.1%} wins, {sr['loss_rate']:.1%} losses, {sr['tie_rate']:.1%} ties ({sr['total']} matchups)")
            wwr = report['delta'].get('weighted_winrate', {})
            if wwr:
                print(f"  {'weighted':12s}: {wwr['win_rate']:.1%} wins, {wwr['loss_rate']:.1%} losses, {wwr['tie_rate']:.1%} ties ({wwr['weighting']})")

        # Per-skill breakdown (losses, hallucinations, false activations)
        print(f"\n{'='*60}")
        print("PER-SKILL BREAKDOWN")
        print(f"{'='*60}")
        per_skill = report.get("per_skill", {})
        for skill_id, m in sorted(per_skill.items(), key=lambda x: x[1].get("avg_judge_score") or 0):
            flags = []
            if m["fp"] > 0:
                flags.append(f"FP={m['fp']}")
            if m["fn"] > 0:
                flags.append(f"FN={m['fn']}")
            if m["hallucinations"] > 0:
                flags.append(f"halluc={m['hallucinations']}")
            judge_str = f"judge={m['avg_judge_score']}" if m.get("avg_judge_score") is not None else "no-judge"
            print(f"  {skill_id}: pattern={m['avg_pattern_score']} {judge_str} TP={m['tp']} {' '.join(flags)}")

        # Per-challenge losses (where test lost to control)
        print(f"\n{'='*60}")
        print("CHALLENGE LOSSES (test < control)")
        print(f"{'='*60}")
        loss_details = [v for v in self.winrate_results if v.get("winner") == "A_wins"]
        for v in loss_details[:20]:
            print(f"  {v.get('challenge_id', '?')}: skill={v.get('target_skill', '?')}")
        if len(loss_details) > 20:
            print(f"  ... and {len(loss_details) - 20} more")

        return report


# ─── CLI Entry Point ────────────────────────────────────────────────────────

def mock_agent(task: str, skill_context: str, model: str) -> str:
    """Mock agent function for testing the pipeline structure."""
    return f"[MOCK] Would answer: {task[:100]}... (skill={'provided' if skill_context else 'none'})"


def azure_openai_agent(task: str, skill_context: str, model: str) -> str:
    """Real agent using Azure OpenAI endpoint."""
    try:
        from openai import AzureOpenAI
    except ImportError:
        print("ERROR: openai package required. Install with: pip install openai")
        sys.exit(1)

    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
    api_key = os.environ.get("AZURE_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    api_version = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")
    deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT", model)

    if not endpoint or not api_key:
        print("ERROR: Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY (or OPENAI_API_KEY)")
        print("  Example:")
        print("    $env:AZURE_OPENAI_ENDPOINT = 'https://your-resource.openai.azure.com'")
        print("    $env:AZURE_OPENAI_API_KEY = '<key>'")
        print("    $env:AZURE_OPENAI_DEPLOYMENT = 'gpt-4o-mini'  # optional, defaults to --model")
        sys.exit(1)

    client = AzureOpenAI(
        azure_endpoint=endpoint,
        api_key=api_key,
        api_version=api_version,
    )

    system_prompt = (
        "You are a PostgreSQL expert assistant helping developers with database tasks. "
        "Answer the user's question with a direct, actionable response. "
        "Include specific settings, version-aware caveats, and production-grade details when relevant. "
        "Be concise and focused on the user's actual scenario."
    )
    if skill_context:
        system_prompt += f"\n\n## Reference Material\n{skill_context}"

    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task},
        ],
        temperature=0.2,
        max_completion_tokens=1500,
    )

    return response.choices[0].message.content or ""


def openai_agent(task: str, skill_context: str, model: str) -> str:
    """Real agent using OpenAI API directly."""
    try:
        from openai import OpenAI
    except ImportError:
        print("ERROR: openai package required. Install with: pip install openai")
        sys.exit(1)

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("ERROR: Set OPENAI_API_KEY environment variable")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    system_prompt = (
        "You are a PostgreSQL expert assistant helping developers with database tasks. "
        "Answer the user's question with a direct, actionable response. "
        "Include specific settings, version-aware caveats, and production-grade details when relevant. "
        "Be concise and focused on the user's actual scenario."
    )
    if skill_context:
        system_prompt += f"\n\n## Reference Material\n{skill_context}"

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task},
        ],
        temperature=0.2,
        max_completion_tokens=1500,
    )

    return response.choices[0].message.content or ""


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="PostgreSQL Agent Skills Eval Pipeline")
    parser.add_argument("--challenges", default=str(DEFAULT_CHALLENGES_PATH))
    parser.add_argument("--skills-root", default=str(DEFAULT_SKILLS_ROOT))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--model", default="gpt-4o-mini")
    parser.add_argument("--judge-model", default=None,
                        help="Optional model for judge calls; defaults to --model")
    parser.add_argument("--dry-run", action="store_true", help="Use mock agent")
    parser.add_argument("--provider", default="auto", choices=["auto", "azure", "openai"],
                        help="LLM provider: azure, openai, or auto (detect from env vars)")
    parser.add_argument("--no-judge", action="store_true",
                        help="Disable LLM-as-judge scoring (faster, uses pattern-only delta)")
    parser.add_argument("--concurrency", type=int, default=5,
                        help="Number of challenges to run in parallel (default: 5, use 1 for sequential)")
    parser.add_argument("--calibration-mode", action="store_true",
                        help="Trim skill content to task-relevant sections (default: load full skill as in production)")
    args = parser.parse_args()

    pipeline = EvalPipeline(
        challenges_path=args.challenges,
        skills_root=args.skills_root,
        output_dir=args.output,
    )

    if args.dry_run:
        pipeline.run(mock_agent, model=args.model, judge_model=args.judge_model, use_judge=False, concurrency=1, calibration_mode=args.calibration_mode)
    else:
        # Auto-detect provider
        provider = args.provider
        if provider == "auto":
            if os.environ.get("AZURE_OPENAI_ENDPOINT"):
                provider = "azure"
            elif os.environ.get("OPENAI_API_KEY"):
                provider = "openai"
            else:
                print("ERROR: No API credentials found. Set environment variables:")
                print("")
                print("  For Azure OpenAI:")
                print("    $env:AZURE_OPENAI_ENDPOINT = 'https://your-resource.openai.azure.com'")
                print("    $env:AZURE_OPENAI_API_KEY = '<key>'")
                print("    $env:AZURE_OPENAI_DEPLOYMENT = 'gpt-4o'  # optional")
                print("")
                print("  For OpenAI:")
                print("    $env:OPENAI_API_KEY = 'sk-...'")
                print("")
                print("  Or use --dry-run for pipeline validation without API calls.")
                sys.exit(1)

        use_judge = not args.no_judge
        if provider == "azure":
            print(f"Using Azure OpenAI (deployment: {os.environ.get('AZURE_OPENAI_DEPLOYMENT', args.model)})")
            pipeline.run(azure_openai_agent, model=args.model, judge_model=args.judge_model, use_judge=use_judge, concurrency=args.concurrency, calibration_mode=args.calibration_mode)
        else:
            print(f"Using OpenAI ({args.model})")
            pipeline.run(openai_agent, model=args.model, judge_model=args.judge_model, use_judge=use_judge, concurrency=args.concurrency, calibration_mode=args.calibration_mode)
