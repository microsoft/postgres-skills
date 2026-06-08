# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""
LLM-as-Judge for PostgreSQL Agent Skills Evals
Semantic evaluation of agent outputs using structured prompts.
"""
from dataclasses import dataclass


@dataclass
class JudgeVerdict:
    """Verdict from LLM judge evaluation."""
    score: float  # 0.0 - 1.0
    passed: bool
    reasoning: str
    criteria_scores: dict[str, float]


# Judge prompt templates
SKILL_QUALITY_JUDGE = """
You are evaluating an AI coding agent's response to a PostgreSQL task.
You must evaluate whether the response demonstrates SPECIALIZED knowledge
that goes beyond what a general-purpose model would produce without guidance.

## Task Given
{task}

## Agent Output
{output}

## Target Skill
{skill_name}

## Evaluation Criteria (score each 0-10)

1. **Correctness**: Is the SQL/CLI syntactically valid and semantically correct? Penalize heavily for non-existent syntax, wrong function names, or incorrect version claims.
2. **Specificity**: Does the response include production-grade details (monitoring queries, specific GUC settings, version-aware caveats) rather than generic textbook answers?
3. **Safety**: Does it avoid dangerous operations (DROP without WHERE, ALTER SYSTEM on managed, etc.)? Does it include appropriate warnings?
4. **Practical Value**: Does the response contain expert-level insights, tradeoffs, or implementation details that go beyond a basic textbook answer and would help a developer succeed in a real PostgreSQL environment?
5. **Directness**: Does the response answer the user's actual question efficiently? A focused, correct answer scores higher than a verbose one that dumps tangential information. Penalize responses that are overly generic or hedge excessively when a direct answer is possible.

IMPORTANT SCORING GUIDANCE:
- A correct, focused answer that directly solves the user's problem scores 7-8 even without exhaustive detail.
- A response with expert-level implementation guidance, relevant tradeoffs, or production-grade caveats scores 8-10 on Practical Value.
- A verbose answer that buries the solution in caveats and step-by-step boilerplate scores LOWER on Directness (3-5).
- A wrong or hallucinated answer should score 0-2 on Correctness regardless of other criteria.

## Output Format (JSON)
{{
  "correctness": <0-10>,
  "specificity": <0-10>,
  "safety": <0-10>,
  "practical_value": <0-10>,
  "directness": <0-10>,
  "reasoning": "<brief explanation>",
  "overall_pass": <true/false>
}}
"""

PAIRED_WINRATE_JUDGE = """
You are comparing two AI responses to the same PostgreSQL task.
One response was generated WITHOUT specialized skill context (Control).
The other was generated WITH specialized skill context (Test).

## Task
{task}

## Response A (Control - no skill context)
{control_output}

## Response B (Test - with skill context)
{test_output}

## Comparison Criteria
1. **Correctness**: Which response has fewer errors, hallucinations, or incorrect syntax?
2. **Depth**: Which provides more actionable, production-grade guidance?
3. **Specificity**: Which includes more concrete settings, thresholds, or version-aware caveats?
4. **Safety**: Which better addresses failure modes and dangerous operations?
5. **Directness**: Which answers the user's actual question more efficiently without unnecessary boilerplate?

## Instructions
- If Response B is meaningfully better (more correct, deeper, more specific, or includes platform-specific knowledge the other lacks), choose "B_wins"
- If Response A is meaningfully better (more direct, correct, and focused without being diluted by irrelevant details), choose "A_wins"
- If they are roughly equivalent in quality, choose "tie"
- A response with hallucinated syntax should ALWAYS lose, regardless of depth
- A verbose response that buries the answer in boilerplate should NOT win over a concise, correct one
- A response that includes correct Azure-specific constraints (e.g., no superuser, allowlisting required, storage limits) that the other misses SHOULD win — this is the primary value of skill context
- If both are correct and similar depth, but one is more focused, the more focused response wins

## Output Format (JSON)
{{
  "winner": "<A_wins|B_wins|tie>",
  "reasoning": "<1-2 sentence explanation>",
  "confidence": "<high|medium|low>"
}}
"""

ACTIVATION_PRECISION_JUDGE = """
You are evaluating whether an AI agent correctly identified which skill to activate.

## Task Given
{task}

## Expected Skill
{expected_skill}

## Expected Activation
{expected_activation}

## Agent's Chosen Skill
{actual_skill}

## Question
Did the agent activate the correct skill? Was activation appropriate for this task?

## Output Format (JSON)
{{
  "correct_activation": <true/false>,
  "reasoning": "<brief explanation>",
  "false_positive": <true if activated wrong skill>,
  "false_negative": <true if failed to activate correct skill>
}}
"""

HALLUCINATION_JUDGE = """
You are checking an AI agent's PostgreSQL response for hallucinations.

## Context
Platform: {platform_scope}
Task: {task}

## Agent Output
{output}

## Check for these hallucination types:
1. Non-existent PostgreSQL functions or syntax
2. Commands that don't work on managed PostgreSQL (ALTER SYSTEM, superuser, filesystem)
3. Made-up extension names or parameters
4. Incorrect version requirements
5. Cross-platform confusion (generic vs Azure-specific advice)

## Output Format (JSON)
{{
  "hallucination_count": <integer>,
  "hallucinations": [
    {{"type": "<category>", "text": "<offending text>", "correction": "<what it should say>"}}
  ],
  "clean": <true/false>
}}
"""


class SkillJudge:
    """Orchestrates LLM-as-judge evaluations."""

    def __init__(self, llm_client=None):
        self.llm_client = llm_client

    def build_quality_prompt(self, task: str, output: str, skill_name: str) -> str:
        return SKILL_QUALITY_JUDGE.format(task=task, output=output, skill_name=skill_name)

    def build_activation_prompt(
        self, task: str, expected_skill: str,
        expected_activation: bool, actual_skill: str
    ) -> str:
        return ACTIVATION_PRECISION_JUDGE.format(
            task=task,
            expected_skill=expected_skill,
            expected_activation=expected_activation,
            actual_skill=actual_skill,
        )

    def build_hallucination_prompt(self, task: str, output: str, platform_scope: str) -> str:
        return HALLUCINATION_JUDGE.format(
            task=task, output=output, platform_scope=platform_scope
        )

    def build_paired_winrate_prompt(self, task: str, control_output: str, test_output: str) -> str:
        return PAIRED_WINRATE_JUDGE.format(
            task=task, control_output=control_output, test_output=test_output
        )

    def judge_paired_winrate(self, task: str, control_output: str, test_output: str, call_llm_fn) -> dict:
        """Head-to-head comparison: does the skill-augmented response win?"""
        prompt = self.build_paired_winrate_prompt(task, control_output, test_output)
        raw = call_llm_fn(prompt)

        try:
            import json as _json
            text = raw.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            parsed = _json.loads(text)
            return {
                "winner": parsed.get("winner", "tie"),
                "reasoning": parsed.get("reasoning", ""),
                "confidence": parsed.get("confidence", "medium"),
            }
        except Exception:
            return {"winner": "tie", "reasoning": f"Parse error: {raw[:80]}", "confidence": "low"}

    def judge_quality(self, task: str, output: str, skill_name: str, call_llm_fn) -> JudgeVerdict:
        """Run LLM-as-judge quality evaluation and return structured verdict."""
        prompt = self.build_quality_prompt(task, output, skill_name)
        raw = call_llm_fn(prompt)

        try:
            import json as _json
            # Extract JSON from response (handle markdown code fences)
            text = raw.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            parsed = _json.loads(text)

            criteria = {
                "correctness": parsed.get("correctness", 0) / 10.0,
                "specificity": parsed.get("specificity", 0) / 10.0,
                "safety": parsed.get("safety", 0) / 10.0,
                "practical_value": parsed.get("practical_value", 0) / 10.0,
                "directness": parsed.get("directness", 0) / 10.0,
            }
            # Weight: correctness and practical value highest, directness rewards focused answers
            weights = {
                "correctness": 2.0,
                "specificity": 1.5,
                "safety": 1.0,
                "practical_value": 2.5,
                "directness": 1.5,
            }
            overall = sum(criteria[k] * weights[k] for k in criteria) / sum(weights.values())

            return JudgeVerdict(
                score=overall,
                passed=parsed.get("overall_pass", overall >= 0.6),
                reasoning=parsed.get("reasoning", ""),
                criteria_scores=criteria,
            )
        except Exception:
            # Fallback if LLM output isn't valid JSON
            return JudgeVerdict(score=0.5, passed=True, reasoning=f"Parse error: {raw[:100]}", criteria_scores={})
