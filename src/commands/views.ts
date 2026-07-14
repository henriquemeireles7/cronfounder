/**
 * board · inbox — the human's two windows into the system. Read-only over
 * the ledger; also regenerate the static HTML snapshots.
 */
import { computeBoard, computeInbox } from "../render/viewmodel.js";
import { renderBoardTerminal, renderInboxTerminal } from "../render/terminal.js";
import { writeHtmlSnapshots } from "../render/html.js";
import type { Store } from "../core/store.js";
import type { Out } from "../output.js";

export async function boardCommand(store: Store, out: Out): Promise<void> {
  const board = computeBoard(store);
  const inbox = computeInbox(store);
  let htmlNote = "";
  try {
    const paths = await writeHtmlSnapshots(store, board, inbox);
    htmlNote = paths.board;
  } catch {
    /* read-only fs is fine */
  }
  out.ok("board", board, () => {
    out.print(renderBoardTerminal(board));
    if (htmlNote) out.print(`\nhtml snapshot: ${htmlNote}`);
  });
}

export async function inboxCommand(store: Store, out: Out): Promise<void> {
  const board = computeBoard(store);
  const inbox = computeInbox(store);
  try {
    await writeHtmlSnapshots(store, board, inbox);
  } catch {
    /* fine */
  }
  out.ok("inbox", inbox, () => {
    out.print(renderInboxTerminal(inbox));
  });
}
