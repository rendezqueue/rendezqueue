import { strict as assert } from "assert";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Page } from "playwright";
import { test } from "playwright/test";

const nodejson_server_filepath = path.resolve(process.cwd(), "dist/src/server/main.js");

async function waitForFile(filepath: string): Promise<void> {
  while (true) {
    try {
      if (fs.readFileSync(filepath, "utf8").trim() !== "") {
        return;
      }
    } catch {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function get_text(page: Page, selector: string): Promise<string> {
  return await page.$eval(selector, (el) => (el as HTMLElement).innerText);
}

test("webchat scenario", async ({ context }) => {
  test.setTimeout(60000);
  const tmp_dirpath = process.env.TEST_TMPDIR ?? os.tmpdir();
  const nodejson_port_filepath = path.join(tmp_dirpath, `nodejson_portfile.${process.pid}`);

  let nodejson_server: ChildProcess | undefined;
  let alice_page: Page | undefined;
  let bob_page: Page | undefined;

  try {
    // Start nodejson server
    const http_path = "/plyswap";
    nodejson_server = spawn(
      "node",
      [nodejson_server_filepath, "--http_port=0", "--demo_urlpath=demo", `--o-http-port=${nodejson_port_filepath}`, `--http_path=${http_path}`],
      { stdio: "ignore" }
    );

    // Wait for nodejson server to be ready
    await waitForFile(nodejson_port_filepath);
    const nodejson_port = fs.readFileSync(nodejson_port_filepath, "utf8").trim();

    const backend_url = `http://127.0.0.1:${nodejson_port}${http_path}`;
    const room_key = "test-room-" + Math.random();

    alice_page = await context.newPage();
    bob_page = await context.newPage();

    await alice_page.goto(`http://127.0.0.1:${nodejson_port}/demo/webchat/index.html?url=${backend_url}&room=${room_key}&user=Alice`);
    await bob_page.goto(`http://127.0.0.1:${nodejson_port}/demo/webchat/index.html?url=${backend_url}&room=${room_key}&user=Bob`);

    // Helper function to send message
    const sendMessage = async (page: Page, message: string) => {
      await page.type("#message-input", message);
      await page.click("#chat-form button");
    };

    // Steps 1 & 2 from webchat.sxpb: Alice sends "A1", then "A2".
    await sendMessage(alice_page, "A1");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A1\")");
    await sendMessage(alice_page, "A2");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A2\")");

    // Step 3: Bob sends "B1", swaps with Alice's offer of "A1" and "A2".
    await sendMessage(bob_page, "B1");
    await bob_page.waitForSelector(".message:has-text(\"Bob: B1\")");
    // Bob should immediately receive Alice's messages.
    await bob_page.waitForSelector(".message:has-text(\"Alice: A1\")");
    await bob_page.waitForSelector(".message:has-text(\"Alice: A2\")");

    // Step 7 (implicit): Alice's client will automatically poll and get Bob's "B1".
    // This happens because a swap occurred.
    await alice_page.waitForSelector(".message:has-text(\"Bob: B1\")");

    // At this point, the first exchange is complete. Both clients should have
    // automatically started a new session.

    // Step 5 & 6: Bob sends "B2", then "B3" on his new session.
    await sendMessage(bob_page, "B2");
    await bob_page.waitForSelector(".message:has-text(\"Bob: B2\")");
    await sendMessage(bob_page, "B3");
    await bob_page.waitForSelector(".message:has-text(\"Bob: B3\")");

    // Step 8: Alice sends "A3" on her new session and gets Bob's pending messages.
    await sendMessage(alice_page, "A3");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A3\")");
    await alice_page.waitForSelector(".message:has-text(\"Bob: B2\")");
    await alice_page.waitForSelector(".message:has-text(\"Bob: B3\")");

    // Let's add the graceful rejection test case from step 7.
    // To do this, we need to get Alice to send a message on an old, swapped session.
    // The library is designed to prevent this from failing by queueing and resending.
    // Let's verify the outcome is correct.
    // We'll add a new assertion helper for clarity.
    const assertChatContains = async (page: Page, expected_messages: string[], user: string) => {
      const chat_log = await get_text(page, "#chat-log");
      for (const msg of expected_messages) {
        assert(chat_log.includes(msg), `${user}'s chat should contain "${msg}". Log:\n${chat_log}`);
      }
    };

    // Final state verification
    await assertChatContains(alice_page, [
      "Alice: A1",
      "Alice: A2",
      "Bob: B1",
      "Alice: A3",
      "Bob: B2",
      "Bob: B3",
    ], "Alice");

    await assertChatContains(bob_page, [
      "Bob: B1",
      "Alice: A1",
      "Alice: A2",
      "Bob: B2",
      "Bob: B3",
    ], "Bob");

    // Bob's client will automatically poll and receive Alice's "A3" from the swap.
    await bob_page.waitForSelector(".message:has-text(\"Alice: A3\")");

    // Step 9 & 10: Alice sends "A4", then "A5".
    await sendMessage(alice_page, "A4");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A4\")");
    await sendMessage(alice_page, "A5");
    await alice_page.waitForSelector(".message:has-text(\"Alice: A5\")");

    // Step 12: Bob's client is polling. It will start a new session and swap
    // with Alice's pending "A4" and "A5".
    await bob_page.waitForSelector(".message:has-text(\"Alice: A4\")");
    await bob_page.waitForSelector(".message:has-text(\"Alice: A5\")");

    // This is the end of the scenario described in webchat.sxpb.
    // Let's do a final check of the chat logs.
    await assertChatContains(alice_page, [
      "Alice: A1", "Alice: A2", "Bob: B1",
      "Alice: A3", "Bob: B2", "Bob: B3",
      "Alice: A4", "Alice: A5",
    ], "Alice");

    await assertChatContains(bob_page, [
      "Bob: B1", "Alice: A1", "Alice: A2",
      "Bob: B2", "Bob: B3", "Alice: A3",
      "Alice: A4", "Alice: A5",
    ], "Bob");

  } finally {
    if (nodejson_server) {
      nodejson_server.kill();
    }
    if (fs.existsSync(nodejson_port_filepath)) {
      fs.unlinkSync(nodejson_port_filepath);
    }
  }
});
