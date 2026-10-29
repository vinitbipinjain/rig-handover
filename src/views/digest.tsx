import type { Night } from '../digest/types.js';

const DASH = '—';

export function DigestPage({ night }: { night: Night }) {
  const { ok, retry, fail } = night.counts;
  return (
    <>
      <h1>digest · {night.night}</h1>
      {night.badLines > 0 && (
        <p class="warn">
          {night.badLines === 1 ? '1 line' : `${night.badLines} lines`} in the run log could not be read
        </p>
      )}
      {night.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <>
          <p class="mute">
            {ok} ok · {retry} retry · {fail} fail
          </p>
          <table>
            <thead>
              <tr>
                <th>job</th>
                <th>owner</th>
                <th>runs</th>
                <th>retries</th>
                <th>last status</th>
                <th>last error</th>
                <th>first</th>
                <th>last</th>
              </tr>
            </thead>
            <tbody>
              {night.rows.map((r) => (
                <tr class={r.retries >= 3 || r.lastStatus === 'fail' ? 'warn' : undefined}>
                  <td>{r.job}</td>
                  <td>{r.owner ?? DASH}</td>
                  <td>{r.runs}</td>
                  <td>{r.retries}</td>
                  <td>{r.lastStatus}</td>
                  <td>{r.lastError ?? DASH}</td>
                  <td>{r.firstAt}</td>
                  <td>{r.lastAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
