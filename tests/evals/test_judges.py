import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from judges import SkillJudge, parse_json_object


class JsonResponseTests(unittest.TestCase):
    def test_parses_fenced_json(self):
        self.assertEqual(parse_json_object('```json\n{"winner":"tie"}\n```'), {"winner": "tie"})

    def test_parses_json_after_leading_prose(self):
        self.assertEqual(
            parse_json_object('Result follows:\n{"winner":"B_wins","confidence":"high"}'),
            {"winner": "B_wins", "confidence": "high"},
        )

    def test_rejects_empty_response(self):
        with self.assertRaises(ValueError):
            parse_json_object("")

    def test_quality_judge_uses_embedded_json(self):
        judge = SkillJudge()
        verdict = judge.judge_quality(
            task="task",
            output="output",
            skill_name="skill",
            call_llm_fn=lambda _: (
                'Here is the result: {"correctness":8,"specificity":7,"safety":9,'
                '"practical_value":8,"directness":7,"reasoning":"good","overall_pass":true}'
            ),
        )

        self.assertTrue(verdict.passed)
        self.assertNotIn("Parse error", verdict.reasoning)

    def test_quality_judge_fails_closed_on_empty_response(self):
        judge = SkillJudge()
        verdict = judge.judge_quality(
            task="task",
            output="output",
            skill_name="skill",
            call_llm_fn=lambda _: "",
        )

        self.assertFalse(verdict.passed)
        self.assertEqual(verdict.score, 0.0)


if __name__ == "__main__":
    unittest.main()
