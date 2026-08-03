# Security policy

Sibyl is an experimental, unaudited security research project. The repository is public so its claims can be challenged; publication is not proof that the design is secure.

## Supported versions

| Version | Status |
| --- | --- |
| Paper Stamp Protocol v2 | Active prototype; security reports welcome |
| Mobile token/grid prototype | Legacy and unsupported |
| Punch-card prototype | Legacy and unsupported |

## Report a vulnerability privately

Do not publish an exploitable vulnerability, real credential, private key, paper stamp, or readable message in a public issue.

Use **Report a vulnerability** in this repository's GitHub Security tab. If private vulnerability reporting is not available, open a public issue containing no sensitive details and ask the maintainers to establish a private channel.

Include:

- the affected commit or deployed version;
- the security property you expected;
- the smallest reproducible example;
- the attacker capabilities you assumed;
- the impact, without including anyone else's private data.

## Research boundaries

- Use accounts, messages, helpers, and infrastructure you own or have permission to test.
- Do not access another person's data or degrade the public service.
- Do not test with real secrets; the prototype is unaudited.
- Give maintainers a reasonable opportunity to understand and address a report before public disclosure.

There is currently no bug bounty or guaranteed response-time commitment.

## Known security limitations

The known limitations are part of the public design, not hidden exceptions. Read [docs/threat-model.md](docs/threat-model.md) before testing or making security claims.
