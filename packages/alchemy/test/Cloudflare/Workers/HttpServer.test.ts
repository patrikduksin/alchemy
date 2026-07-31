import { makeRequestEffect } from "@/Cloudflare/Workers/HttpServer";
import type { HttpEffect } from "@/Http";
import { describe, expect, it } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as ErrorReporter from "effect/ErrorReporter";
import * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

describe("Cloudflare.Workers.HttpServer", () => {
  it("preserves Effect HTTP error responses without reporting ignored errors", async () => {
    const reported: Error[] = [];
    const response = await runRequest(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        return yield* Effect.die(
          new HttpServerError.RouteNotFound({ request }),
        );
      }),
      reported,
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(reported).toHaveLength(0);
  });

  it("does not expose sensitive error context over a Worker response", async () => {
    const sensitiveContext = [
      "sk_live_alchemy_super_secret",
      "tenant-customer-42",
      "/srv/alchemy/private/customer-42.json",
      "10.42.0.17",
    ];
    const reported: Error[] = [];
    const response = await runRequest(
      Effect.fail(
        new Error(`Sensitive handler context: ${sensitiveContext.join(" ")}`),
      ).pipe(Effect.orDie),
      reported,
    );

    const responseBody = await response.text();
    const wireResponse = [
      response.statusText,
      JSON.stringify(Object.fromEntries(response.headers.entries())),
      responseBody,
    ].join("\n");

    expect(response.status).toBe(500);
    expect(responseBody).toBe("");
    for (const sensitiveValue of sensitiveContext) {
      expect(wireResponse).not.toContain(sensitiveValue);
      expect(
        reported.some((error) => error.message.includes(sensitiveValue)),
      ).toBe(true);
    }
  });
});

const runRequest = (
  handler: HttpEffect,
  reported: Error[],
): Promise<Response> =>
  Effect.runPromise(
    makeRequestEffect(
      new Request("https://worker.example/private", {
        headers: {
          "cf-connecting-ip": "203.0.113.42",
        },
      }) as any,
      handler,
    ).pipe(
      Effect.provide(
        ErrorReporter.layer([
          ErrorReporter.make(({ error }) => reported.push(error)),
        ]),
      ),
    ) as Effect.Effect<Response>,
  );
