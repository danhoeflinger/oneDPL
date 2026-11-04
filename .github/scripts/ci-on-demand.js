// Helpers for the on-demand CI control at the bottom of PR descriptions.
// Used by .github/workflows/ci-on-demand.yml and .github/workflows/ci-testing.yml via actions/github-script.
//
// The control is a marked block in the PR description with one of two states:
//   idle:    an unchecked "Run public CI" checkbox; checking it requests a run
//   running: plain text (nothing to click) with a link to the run, so a run cannot be requested twice
//
// The PR description is untrusted input: it is only parsed here, never executed or interpolated into a shell.

const START = '<!-- onedpl-ci-button:start -->';
const END = '<!-- onedpl-ci-button:end -->';
const STATUS_CONTEXT = 'oneDPL CI Testing (on demand)';
const CI_WORKFLOW = 'ci-testing.yml';

function findBlock(body) {
    const s = body.indexOf(START);
    const e = s < 0 ? -1 : body.indexOf(END, s);
    return (s < 0 || e < 0) ? null : { s, e: e + END.length };
}

// Returns { kind: 'missing' | 'idle' | 'checked' | 'running', sha? }
function parse(body) {
    body = body || '';
    const b = findBlock(body);
    if (!b)
        return { kind: 'missing' };
    const block = body.slice(b.s, b.e);
    const running = block.match(/<!-- onedpl-ci-state: running ([0-9a-f]{40}) -->/);
    if (running)
        return { kind: 'running', sha: running[1] };
    if (/-\s*\[[xX]\]\s*\*\*Run public CI\*\*/.test(block))
        return { kind: 'checked' };
    return { kind: 'idle' };
}

// state: { kind: 'idle' } | { kind: 'running', sha, runUrl? }
function render(state) {
    let line;
    if (state.kind === 'running') {
        const where = state.runUrl ? `[view run](${state.runUrl})` : 'waiting to start';
        line = `<!-- onedpl-ci-state: running ${state.sha} -->\n` +
               `⏳ **Public CI is running** on ${state.sha.slice(0, 7)} (${where}). ` +
               'The checkbox returns when the run finishes or a new commit is pushed.';
    } else {
        line = '- [ ] **Run public CI** on the latest commit of this PR ' +
               '(requires write access; results appear in the checks below)';
    }
    return [START, '', '---', line, END].join('\n');
}

function withBlock(body, state) {
    body = body || '';
    const b = findBlock(body);
    if (b)
        return body.slice(0, b.s) + render(state) + body.slice(b.e);
    return (body.trimEnd() ? body.trimEnd() + '\n\n' : '') + render(state) + '\n';
}

// Re-reads the PR description (to avoid clobbering concurrent edits), computes the new state with
// decide(currentState, pr) and writes it if it differs. decide returns a state, or null to leave it unchanged.
async function updateBlock(github, context, prNumber, decide) {
    const { owner, repo } = context.repo;
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
    const next = decide(parse(pr.body), pr);
    if (!next)
        return;
    const body = withBlock(pr.body, next);
    if (body !== (pr.body || ''))
        await github.rest.pulls.update({ owner, repo, pull_number: prNumber, body });
}

module.exports = { STATUS_CONTEXT, CI_WORKFLOW, parse, updateBlock };
