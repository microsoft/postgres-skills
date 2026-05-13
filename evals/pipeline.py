"""
PostgreSQL Agent Skills Evaluation Pipeline
Measures skill quality via control vs test group comparison.

Usage:
    python evals/pipeline.py [--challenges PATH] [--output PATH] [--model MODEL]
"""
import json
import os
import sys
import time
import yaml
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))
from matchers import PatternMatcher, HallucinationDetector, SQLSyntaxValidator, TokenBudgetValidator
from judges import SkillJudge


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
        self._judge_agent_fn = None  # Set during run() for judge LLM calls

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

    def load_skill(self, skill_path: str) -> str:
        """Load a SKILL.md file content."""
        full_path = self.skills_root / skill_path / "SKILL.md"
        if full_path.exists():
            return full_path.read_text(encoding="utf-8")
        return ""

    def run_challenge(self, challenge: Challenge, agent_fn, group: str, model: str) -> EvalResult:
        """Run a single challenge against the agent function."""
        start = time.time()

        # Call agent (control = no skill context, test = with skill context)
        skill_context = ""
        if group == "test":
            skill_context = self.load_skill(challenge.target_skill)

        output = agent_fn(challenge.task, skill_context, model)
        latency_ms = (time.time() - start) * 1000

        # Evaluate patterns
        pattern_result = self.matcher.evaluate(
            output,
            challenge.expected_patterns,
            challenge.anti_patterns
        )

        # Check hallucinations
        hallucinations = self.hallucination_detector.check(output)

        # SQL validation
        sql_result = self.sql_validator.validate(output)

        # Token budget
        tier = "azure-ai" if "ai-" in challenge.target_skill or "rag" in challenge.target_skill \
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
                return self._judge_agent_fn(prompt, "", model)
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

        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
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

        print(f"Report saved: {report_path}")
        print(f"Results saved: {results_path}")
        return report_path, results_path

    def run(self, agent_fn, model: str = "gpt-4o", use_judge: bool = True):
        """Execute full pipeline: control + test for all challenges."""
        self.load_challenges()

        # Wire up judge agent function (same LLM as the eval agent)
        if use_judge and agent_fn != mock_agent:
            self._judge_agent_fn = agent_fn
        else:
            self._judge_agent_fn = None

        judge_status = "enabled (LLM-as-judge)" if self._judge_agent_fn else "disabled (pattern-only)"
        print(f"\n{'='*60}")
        print(f"Running eval pipeline: {len(self.challenges)} challenges x 2 groups")
        print(f"Model: {model}")
        print(f"Judge: {judge_status}")
        print(f"{'='*60}\n")

        for i, challenge in enumerate(self.challenges):
            print(f"[{i+1}/{len(self.challenges)}] {challenge.id} ({challenge.difficulty})")

            # Control group (no skill)
            self.run_challenge(challenge, agent_fn, "control", model)

            # Test group (with skill)
            self.run_challenge(challenge, agent_fn, "test", model)

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
        print(f"Hallucinations: {report['summary']['hallucination_rate']}")
        print(f"False Activation Rate: {report['summary']['false_activation_rate']}")

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
        print("    $env:AZURE_OPENAI_DEPLOYMENT = 'gpt-4o'  # optional, defaults to --model")
        sys.exit(1)

    client = AzureOpenAI(
        azure_endpoint=endpoint,
        api_key=api_key,
        api_version=api_version,
    )

    system_prompt = "You are a PostgreSQL expert assistant helping developers with database tasks."
    if skill_context:
        system_prompt += f"\n\nUse the following skill reference:\n\n{skill_context}"

    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task},
        ],
        temperature=0.2,
        max_tokens=1500,
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

    system_prompt = "You are a PostgreSQL expert assistant helping developers with database tasks."
    if skill_context:
        system_prompt += f"\n\nUse the following skill reference:\n\n{skill_context}"

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task},
        ],
        temperature=0.2,
        max_tokens=1500,
    )

    return response.choices[0].message.content or ""


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="PostgreSQL Agent Skills Eval Pipeline")
    parser.add_argument("--challenges", default="evals/challenges/challenges.yaml")
    parser.add_argument("--skills-root", default=".")
    parser.add_argument("--output", default="evals/results")
    parser.add_argument("--model", default="gpt-4o")
    parser.add_argument("--dry-run", action="store_true", help="Use mock agent")
    parser.add_argument("--provider", default="auto", choices=["auto", "azure", "openai"],
                        help="LLM provider: azure, openai, or auto (detect from env vars)")
    parser.add_argument("--no-judge", action="store_true",
                        help="Disable LLM-as-judge scoring (faster, uses pattern-only delta)")
    args = parser.parse_args()

    pipeline = EvalPipeline(
        challenges_path=args.challenges,
        skills_root=args.skills_root,
        output_dir=args.output,
    )

    if args.dry_run:
        pipeline.run(mock_agent, model=args.model, use_judge=False)
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
            pipeline.run(azure_openai_agent, model=args.model, use_judge=use_judge)
        else:
            print(f"Using OpenAI ({args.model})")
            pipeline.run(openai_agent, model=args.model, use_judge=use_judge)
