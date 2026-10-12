import { mkdirSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { createAuditFixture } from "./worktree-audit.fixture";

const fixture = createAuditFixture();
afterAll(fixture.cleanup);
const { root, home, repo, git } = fixture;
const pushed = (branch: string) => {
	const directory = join(root, branch);
	git(repo, "worktree", "add", "-b", branch, directory, "main");
	writeFileSync(join(directory, branch), `${branch}\n`);
	git(directory, "add", branch);
	git(directory, "commit", "-m", branch);
	git(directory, "push", "origin", branch);
	return realpathSync(directory);
};
const cursor = pushed("cursor-chat");
const claude = pushed("claude-chat");
pushed("no-chat");
fixture.setPrs([]);

const timestamp = new Date(Date.now() - 60 * 60 * 1000);
const expectedDate = [
	timestamp.getFullYear(),
	String(timestamp.getMonth() + 1).padStart(2, "0"),
	String(timestamp.getDate()).padStart(2, "0"),
].join("-");
const transcript = (directory: string, content: string) => {
	mkdirSync(directory, { recursive: true });
	const file = join(directory, "x.jsonl");
	writeFileSync(file, `${content}\n`);
	utimesSync(file, timestamp, timestamp);
};

test("worktree audit reads Cursor transcripts by default", () => {
	const slug = realpathSync(repo).replace(/^\//, "").replaceAll("/", "-");
	transcript(join(home, ".cursor", "projects", slug, "agent-transcripts", "x"), `${cursor}/`);
	const result = fixture.audit({ PSTACK_TRANSCRIPTS_DIR: "" });
	expect(result.status).toBe(0);
	expect(result.rows["cursor-chat"]).toEqual({
		merged: "no", dirty: "clean", remote: "pushed", pr: "-",
		lastChat: expectedDate, bucket: "verify-recent-chat",
	});
});

test("worktree audit reads an override recursively and leaves unmentioned worktrees alone", () => {
	const directory = join(root, "claude-transcripts");
	transcript(join(directory, "project"), JSON.stringify({ cwd: claude }));
	const result = fixture.audit({ PSTACK_TRANSCRIPTS_DIR: directory });
	expect(result.status).toBe(0);
	expect(result.rows["claude-chat"]).toEqual({
		merged: "no", dirty: "clean", remote: "pushed", pr: "-",
		lastChat: expectedDate, bucket: "verify-recent-chat",
	});
	expect(result.rows["no-chat"]).toEqual({
		merged: "no", dirty: "clean", remote: "pushed", pr: "-",
		lastChat: "-", bucket: "review",
	});
});

test("worktree audit warns when the transcript directory is missing", () => {
	const directory = join(root, "missing-transcripts");
	const result = fixture.audit({ PSTACK_TRANSCRIPTS_DIR: directory });
	expect(result.status).toBe(0);
	expect(result.rows["no-chat"]).toEqual({
		merged: "no", dirty: "clean", remote: "pushed", pr: "-",
		lastChat: "n/a", bucket: "review",
	});
	expect(result.stderr).toContain(
		`warn: no transcripts at ${directory}; LAST_CHAT is n/a. Set PSTACK_TRANSCRIPTS_DIR to the agent's transcript dir.\n`,
	);
});
