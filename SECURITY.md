# Security policy

## Scope

op-agent is a guardrail, not a sandbox. The prod approval stops mistakes and agents that are not trying to get around it. Claude runs as your user, so anything it can execute as that user can also reach the token files. The hard limits are the scope, expiry and contents of each Service Account vault.

The known limits are listed in the README under "What it protects and what it doesn't". Reports about those are not vulnerabilities.

## Supported versions

Only the 0.2.x line gets fixes.

## Reporting a vulnerability

Please report privately with GitHub's "Report a vulnerability" button (Security tab of https://github.com/efrageek/op-agent). Do not open a public issue.

What counts:

- Bypassing the prod approval from a tool call the hook sees.
- Leaks of the token, the ticket, or their paths.
- Argument injection through the wrapper (`run`, `ssh`, `ssh-window`, `ls`).

What does not count: anything that needs a process running as the same user to read the token files, or to read or write the ticket directly (such a process can forge a ticket), and the other limits in the README.
