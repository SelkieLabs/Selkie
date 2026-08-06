import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FileKeep } from "./keep";

function scratch(): string {
  return join(mkdtempSync(join(tmpdir(), "selkie-keep-")), "nested", "state.json");
}

describe("keeping state on disk", () => {
  it("hands back what a previous process wrote", () => {
    const path = scratch();
    new FileKeep(path).write("wallets", ["S-one", "S-two"]);

    assert.deepEqual(new FileKeep(path).read("wallets"), ["S-one", "S-two"]);
  });

  it("starts empty the first time, rather than failing", () => {
    assert.equal(new FileKeep(scratch()).read("wallets"), undefined);
  });

  it("makes the folder it was pointed at", () => {
    const path = scratch();
    new FileKeep(path).write("a", 1);
    assert.ok(statSync(path).isFile());
  });

  it("keeps every shelf, not just the last one written", () => {
    const path = scratch();
    const keep = new FileKeep(path);
    keep.write("users", [{ id: "u1" }]);
    keep.write("accounts", [{ address: "G..." }]);

    const reopened = new FileKeep(path);
    assert.deepEqual(reopened.read("users"), [{ id: "u1" }]);
    assert.deepEqual(reopened.read("accounts"), [{ address: "G..." }]);
  });

  it("is readable only by the account that runs the server", () => {
    // It holds the key to every wallet. World-readable would mean anybody with
    // a shell on the box can empty all of them.
    const path = scratch();
    new FileKeep(path).write("wallets", ["S-secret"]);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it("does not let a caller edit the shelf by holding on to what it read", () => {
    const path = scratch();
    const keep = new FileKeep(path);
    keep.write("wallets", ["S-one"]);

    const held = keep.read<string[]>("wallets") ?? [];
    held.push("S-smuggled");

    assert.deepEqual(keep.read("wallets"), ["S-one"]);
  });

  it("leaves no half-written file behind for the next process to read", () => {
    // The write is a rename over the top, so a reader sees the whole old file
    // or the whole new one. Checked by proving the file always parses.
    const path = scratch();
    const keep = new FileKeep(path);
    for (let n = 0; n < 25; n++) {
      keep.write("wallets", Array.from({ length: n }, (_, i) => `S-${i}`));
      JSON.parse(readFileSync(path, "utf8"));
    }
    assert.equal((new FileKeep(path).read<string[]>("wallets") ?? []).length, 24);
  });
});

describe("when the file cannot be read", () => {
  it("refuses to start rather than coming up as a brand new server", () => {
    // Starting empty is the dangerous option. The server would look healthy,
    // mint fresh wallets for everyone signing in, and strand every account it
    // could not read, with nothing anywhere reporting a problem.
    const path = scratch();
    new FileKeep(path).write("wallets", ["S-one"]);
    writeFileSync(path, "{ this is not json");

    assert.throws(() => new FileKeep(path), /Refusing to start/);
  });

  it("says where the file is, because the person reading it has to go and look", () => {
    const path = scratch();
    new FileKeep(path).write("wallets", ["S-one"]);
    writeFileSync(path, "[]");

    assert.throws(() => new FileKeep(path), new RegExp(path.replace(/[/\\]/g, "\\$&")));
  });
});
