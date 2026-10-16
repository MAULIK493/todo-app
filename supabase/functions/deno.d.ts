// Minimal typing for the parts of the Deno runtime the Edge Functions use (the real runtime provides them).
declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(key: string): string | undefined }
}
