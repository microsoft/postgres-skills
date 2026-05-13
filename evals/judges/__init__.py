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
The agent had access to a skill file with best practices.

## Task Given
{task}

## Agent Output
{output}

## Target Skill
{skill_name}

## Evaluation Criteria (score each 0-10)

1. **Correctness**: Is the SQL/CLI syntactically valid and semantically correct?
2. **Completeness**: Does it fully address the user's task?
3. **Safety**: Does it avoid dangerous operations (DROP without WHERE, ALTER SYSTEM on managed, etc.)?
4. **Best Practice Alignment**: Does it follow the patterns from the skill?
5. **Managed Service Awareness**: Does it respect Azure PostgreSQL constraints (no superuser, no filesystem access)?

## Output Format (JSON)
{{
  "correctness": <0-10>,
  "completeness": <0-10>,
  "safety": <0-10>,
  "best_practice": <0-10>,
  "managed_awareness": <0-10>,
  "reasoning": "<brief explanation>",
  "overall_pass": <true/false>
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
