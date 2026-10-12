#!/usr/bin/env python3
"""Holds the pipeline to what .claude/rules/cicd.md says it is (as in ../backseat-driver).

Plain text checks (no YAML library): every action pinned to a commit and the
container to a digest, every workflow with its own permissions, `check` never
path-filtered and required by master's ruleset, owner-merge.yml approving only
the owner's pull requests without ever running their code, and the Cloudflare
token only where a pull request can never reach it: deploy.yml's jobs in the
production environment, which runs on master only.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"
RULESET = ROOT / ".github" / "rulesets" / "master.json"
OWNER_ID = "26800291"  # a-schaefers
GITHUB_ACTIONS_APP = 15368


def text(name: str) -> str:
    return (WORKFLOWS / name).read_text()


class Pins(unittest.TestCase):
    def test_every_action_is_pinned_to_a_commit(self):
        for path in sorted(WORKFLOWS.glob("*.yml")):
            for line in path.read_text().splitlines():
                m = re.search(r"\buses:\s*(\S+)(.*)", line)
                if not m or line.lstrip().startswith("#"):
                    continue
                ref = m.group(1)
                if ref.startswith("./.github/workflows/"):
                    continue  # this repository's own workflow, at the same commit
                with self.subTest(file=path.name, uses=ref):
                    self.assertRegex(ref, r"^[\w.-]+/[\w./-]+@[0-9a-f]{40}$", "pin a commit, not a tag")
                    self.assertRegex(m.group(2), r"#\s*v\d", "say which version the commit is")

    def test_every_workflow_sets_its_permissions(self):
        for path in sorted(WORKFLOWS.glob("*.yml")):
            with self.subTest(file=path.name):
                self.assertRegex(path.read_text(), r"(?m)^permissions:")


class RequiredCheck(unittest.TestCase):
    def test_check_runs_on_every_pull_request(self):
        on = text("check.yml").split("\njobs:")[0]
        self.assertIn("pull_request:", on)
        self.assertNotRegex(on, r"paths(-ignore)?:", "a required check must report on every pull request")
        self.assertRegex(text("check.yml"), r"(?m)^  check:$")

    def test_ruleset_requires_it_from_github_actions(self):
        rules = {r["type"]: r.get("parameters", {}) for r in json.loads(RULESET.read_text())["rules"]}
        checks = rules["required_status_checks"]["required_status_checks"]
        self.assertIn({"context": "check", "integration_id": GITHUB_ACTIONS_APP}, checks)


class Ruleset(unittest.TestCase):
    def test_master_takes_pull_requests_only_with_an_approval(self):
        ruleset = json.loads(RULESET.read_text())
        rules = {r["type"]: r.get("parameters", {}) for r in ruleset["rules"]}
        self.assertEqual(ruleset["enforcement"], "active")
        self.assertEqual(ruleset["conditions"]["ref_name"]["include"], ["~DEFAULT_BRANCH"])
        self.assertEqual(ruleset["bypass_actors"], [], "no bypass: the owner and every agent alike")
        self.assertIn("deletion", rules)
        self.assertIn("non_fast_forward", rules)
        self.assertEqual(rules["pull_request"]["required_approving_review_count"], 1)
        self.assertTrue(rules["pull_request"]["dismiss_stale_reviews_on_push"])


class OwnerMerge(unittest.TestCase):
    def setUp(self):
        self.text = text("owner-merge.yml")
        self.code = "\n".join(l for l in self.text.splitlines() if not l.lstrip().startswith("#"))

    def test_runs_masters_copy_and_never_the_pull_requests_code(self):
        self.assertIn("pull_request_target:", self.code)
        self.assertNotRegex(self.code, r"\buses:", "no checkout, no action: nothing from the branch runs")
        self.assertNotRegex(self.code, r"\bgit\b|\bnpm\b|\bnode\b|python", "no code from the branch")

    def test_reads_nothing_from_the_event_but_numbers_hashes_and_ids(self):
        used = set(re.findall(r"\$\{\{\s*([^}]+?)\s*\}\}", self.code))
        allowed = {
            "github.event.pull_request.number",
            "github.event.pull_request.head.sha",
            "github.repository",
            "github.token",
        }
        self.assertLessEqual(used, allowed, "event text (a title, a branch name) must never reach a shell")

    def test_approves_only_the_owners_own_pull_request(self):
        cond = re.search(r"if: >-\n((?:\s{6}.+\n)+)", self.code).group(1)
        self.assertIn(f"github.event.pull_request.user.id == {OWNER_ID}", cond)
        self.assertIn(f"github.event.sender.id == {OWNER_ID}", cond)
        self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", cond)
        self.assertIn("!github.event.pull_request.draft", cond)
        self.assertEqual(cond.count("&&"), 3, "every condition must hold")

    def test_approves_and_merges_only_the_head_it_was_woken_for(self):
        self.assertIn('commit_id="$HEAD"', self.code)
        for merge in re.findall(r"gh pr merge [^\n]*--merge[^\n]*", self.code):
            self.assertIn('--match-head-commit "$HEAD"', merge)


    def test_dispatches_the_deploy_its_own_merge_cannot_start(self):
        self.assertIn("actions: write", self.code)
        self.assertIn('gh workflow run deploy.yml --repo "$REPO" --ref master', self.code)


class Secrets(unittest.TestCase):
    """A pull request's code runs in check.yml: no secret may be anywhere it can read."""

    def test_only_the_deploy_and_the_purge_name_a_secret(self):
        for path in sorted(WORKFLOWS.glob("*.yml")):
            if path.name in ("deploy.yml", "purge-cache.yml"):
                continue
            with self.subTest(file=path.name):
                self.assertNotIn("secrets.", path.read_text())

    def test_the_purge_button_runs_on_master_in_production_and_runs_no_code(self):
        purge = text("purge-cache.yml")
        on = purge.split("\njobs:")[0]
        self.assertRegex(on, r"on:\n  workflow_dispatch:\n", "a button, nothing else")
        self.assertNotIn("pull_request", on)
        self.assertIn("environment: production", purge)
        code = "\n".join(l for l in purge.splitlines() if not l.lstrip().startswith("#"))
        self.assertNotRegex(code, r"\buses:", "no checkout: nothing from the repository runs")
        self.assertEqual(set(re.findall(r"secrets\.(\w+)", purge)), {"CLOUDFLARE_PURGE_TOKEN"})

    def test_deploy_runs_on_master_only_and_its_secrets_in_production(self):
        deploy = text("deploy.yml")
        on = deploy.split("\njobs:")[0]
        self.assertNotIn("pull_request", on)
        self.assertRegex(on, r"push:\n\s+branches: \[master\]")
        jobs = re.split(r"(?m)^  (?=[\w-]+:$)", deploy.split("\njobs:\n", 1)[1])
        for job in jobs:
            if "secrets." in job:
                with self.subTest(job=job.split(":")[0]):
                    self.assertIn("environment: production", job)

    def test_deploys_never_overlap_or_cancel(self):
        self.assertRegex(text("deploy.yml"), r"concurrency:\n\s+group: deploy\n\s+cancel-in-progress: false")


class Container(unittest.TestCase):
    def test_the_build_image_is_pinned_to_a_digest(self):
        for image in re.findall(r"image:\s*(\S+)", text("check.yml")):
            self.assertRegex(image, r"@sha256:[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
