import { describe, expect, it } from 'vitest';
import type { HttpRequest } from '../src/api/http';
import { requestUrlTransport, type RequestUrl } from '../src/api/request-url';

// Workspace change `add-notes-write-back` (OBS-024), task 11.12: Obsidian mobile has no Node client,
// so `requestUrl` is its transport, and it must keep the 64 MiB limit of a file answer too.

const MIB = 1024 * 1024;
const CONTENT: HttpRequest = { origin: 'https://edge.example', method: 'GET', path: '/v1/notes/connections/c/device-operations/o/content', headers: {}, answer: 'bytes' };

/** The length of the answer bytes, or the message of the failure. It never prints the bytes. */
async function outcomeOf(requestUrl: RequestUrl): Promise<number | string | undefined> {
  return requestUrlTransport(requestUrl)(CONTENT).then(
    (answer) => answer.bytes?.length,
    (error: unknown) => String(error),
  );
}

/** A `requestUrl` that answers `size` bytes and records whether the body was read. */
function answering(size: number, header = String(size)): { requestUrl: RequestUrl; read: () => boolean } {
  let read = false;
  const requestUrl: RequestUrl = async () => ({
    status: 200,
    text: '',
    headers: { 'content-length': header },
    get arrayBuffer() {
      read = true;
      return new ArrayBuffer(size);
    },
  });
  return { requestUrl, read: () => read };
}

describe('the limits of the mobile transport', () => {
  it('a file answer may pass 8 MiB and stops at 64 MiB', async () => {
    expect(await outcomeOf(answering(8 * MIB + 1).requestUrl)).toBe(8 * MIB + 1);
    expect(String(await outcomeOf(answering(64 * MIB + 1).requestUrl))).toMatch(/64 MiB/);
  });

  it('a length header over 64 MiB is refused before the body is read', async () => {
    const large = answering(1, String(64 * MIB + 1));

    expect(String(await outcomeOf(large.requestUrl))).toMatch(/64 MiB/);
    expect(large.read()).toBe(false);
  });
});
