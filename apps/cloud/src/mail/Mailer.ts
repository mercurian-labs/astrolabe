import * as Credentials from "@distilled.cloud/aws/Credentials";
import * as Endpoint from "@distilled.cloud/aws/Endpoint";
import * as Region from "@distilled.cloud/aws/Region";
import * as SES from "@distilled.cloud/aws/sesv2";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";

export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export class MailSendError extends Data.TaggedError("MailSendError")<{
  readonly cause: unknown;
}> {}

/** Sends the cloud's transactional mail: sign-in codes, invitations, account notices. */
export class Mailer extends Context.Service<
  Mailer,
  { readonly send: (mail: Mail) => Effect.Effect<void, MailSendError> }
>()("@mercurian/cloud/mail/Mailer") {}

const AwsLive = Layer.mergeAll(
  Credentials.fromChain(),
  Region.fromEnv(),
  Endpoint.fromEnv(),
  FetchHttpClient.layer,
);

/**
 * Mail through SES. Locally `AWS_ENDPOINT_URL` points at the emulator, whose
 * mailbox is at http://localhost:4566/_aws/ses.
 */
export const layerSes = (from: string) =>
  Layer.effect(
    Mailer,
    Effect.gen(function* () {
      // Carries the region and endpoint overrides too; only these two are typed.
      const aws = yield* Effect.context<Credentials.Credentials | HttpClient.HttpClient>();
      return Mailer.of({
        send: Effect.fn("Mailer.send")(function* (mail) {
          yield* SES.sendEmail({
            FromEmailAddress: from,
            Destination: { ToAddresses: [mail.to] },
            Content: {
              Simple: {
                Subject: { Data: mail.subject },
                Body: { Text: { Data: mail.text } },
              },
            },
          }).pipe(
            Effect.asVoid,
            Effect.mapError((cause) => new MailSendError({ cause })),
            Effect.provideContext(aws),
          );
        }),
      });
    }),
  ).pipe(Layer.provide(AwsLive));

/** Development without SES: mail goes to the log so codes can still be read. */
export const layerLog = Layer.succeed(
  Mailer,
  Mailer.of({
    send: Effect.fn("Mailer.send")(function* (mail) {
      yield* Effect.logWarning(`mail to ${mail.to}: ${mail.subject}\n${mail.text}`);
    }),
  }),
);
