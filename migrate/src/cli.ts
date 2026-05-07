// Entry point for `loomola-migrate`.
//
// Bun-compiled single Mac binary. Subcommands:
//   granola — import all your Granola notes into a Loomola server.
//   (loom — future, separate spec.)

import { runGranolaImport, type GranolaCliArgs } from "./granola-pipeline";

function parseArgs(argv: string[]): {
  subcommand: string;
  args: Record<string, string | boolean>;
} {
  // First non-flag positional is the subcommand. Flags before it (like
  // `--help` or `--version` with no subcommand) are still parsed.
  const args: Record<string, string | boolean> = {};
  let subcommand = "";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          args[a.slice(2)] = next;
          i++;
        } else {
          args[a.slice(2)] = true;
        }
      }
    } else if (!subcommand) {
      subcommand = a;
    }
  }
  return { subcommand, args };
}

function help(): string {
  return `loomola-migrate granola [options]

Auth & target:
  --server <url>            (default: https://loom.dissonance.cloud)
  --token <jwt>             (or env LOOMOLA_TOKEN)
  --granola-api-key <key>   (or env GRANOLA_API_KEY)
                            When set, uses Granola's official Business
                            API. When unset, reads the local Granola
                            desktop cache (cache-v3/v4 plaintext only).

Scope:
  --since <iso-date>      Only import notes created on/after this date

Concurrency:
  --concurrency <n>       (default: 3, max: 10)

Run modes:
  --dry-run               Preview plan, write nothing
  --resume                Skip already-succeeded ids
  --fresh                 Ignore state.json, start over
  --retry-failed          Only retry previously-failed ids
  --replace-content       Force-overwrite notes.body + ai_outputs.summary
                          on already-imported rows. Use to backfill a
                          content-format change.

Misc:
  --help, --version
`;
}

async function main(): Promise<number> {
  const { subcommand, args } = parseArgs(process.argv);
  if (args.version) {
    console.log("loomola-migrate 0.1.0");
    return 0;
  }
  if (args.help || subcommand === "help" || !subcommand) {
    console.log(help());
    return 0;
  }
  if (subcommand !== "granola") {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error(help());
    return 2;
  }
  const token = (args.token as string) || process.env.LOOMOLA_TOKEN || "";
  if (!token) {
    console.error(
      "Error: --token required (or set LOOMOLA_TOKEN). " +
        "Reveal one at /settings/migration on your Loomola server."
    );
    return 2;
  }
  const cliArgs: GranolaCliArgs = {
    server: (args.server as string) || "https://loom.dissonance.cloud",
    token,
    since: typeof args.since === "string" ? args.since : undefined,
    concurrency: parseInt((args.concurrency as string) || "3", 10),
    dryRun: !!args["dry-run"],
    resume: !!args.resume,
    fresh: !!args.fresh,
    retryFailed: !!args["retry-failed"],
    granolaApiKey:
      (args["granola-api-key"] as string) ||
      process.env.GRANOLA_API_KEY ||
      undefined,
    replaceContent: !!args["replace-content"],
  };
  return await runGranolaImport(cliArgs);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
