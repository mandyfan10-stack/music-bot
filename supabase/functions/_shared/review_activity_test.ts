import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCommentMessage,
  buildReactionMessage,
  type ClaimDecision,
  handleReviewComment,
  handleReviewReaction,
  type ReviewActivityDeps,
  type ReviewActivityKind,
  snippet,
} from "./review_activity.ts";

const AUTHOR = 42;
const RELEASE = { id: "rel-1", name: "Альбом", artist: "Артист" };

type Sent = { chatId: number; text: string; releaseId: string };

function fakeDeps(
  overrides: Partial<{
    reactionCount: number;
    subscriber: { chatId: number; enabled: boolean } | null;
    claim: ClaimDecision;
    otherComments: number;
    reviewExists: boolean;
  }> = {},
) {
  const sent: Sent[] = [];
  const claims: Array<[string, ReviewActivityKind, number | null]> = [];
  const deps: ReviewActivityDeps = {
    getReview: (id) =>
      Promise.resolve(
        overrides.reviewExists === false ? null : {
          id,
          author_id: AUTHOR,
          release_id: RELEASE.id,
          reaction_count: overrides.reactionCount ?? 1,
        },
      ),
    getRelease: () => Promise.resolve(RELEASE),
    getSubscriber: () =>
      Promise.resolve(
        overrides.subscriber === undefined
          ? { chatId: AUTHOR, enabled: true }
          : overrides.subscriber,
      ),
    claim: (reviewId, kind, actorId) => {
      claims.push([reviewId, kind, actorId]);
      return Promise.resolve(
        overrides.claim ?? { decision: "send", previousSentAt: null },
      );
    },
    countOtherCommentsSince: () =>
      Promise.resolve(overrides.otherComments ?? 0),
    sendMessage: (chatId, text, releaseId) => {
      sent.push({ chatId, text, releaseId });
      return Promise.resolve();
    },
  };
  return { deps, sent, claims };
}

Deno.test("a reaction from someone else notifies the author with the total", async () => {
  const { deps, sent, claims } = fakeDeps({ reactionCount: 5 });
  const result = await handleReviewReaction(
    { review_id: "rv-1", user_id: 7 },
    deps,
  );
  assertEquals(result, { status: "sent" });
  assertEquals(claims, [["rv-1", "reaction", 7]]);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].chatId, AUTHOR);
  assertEquals(sent[0].releaseId, "rel-1");
  assertEquals(
    sent[0].text,
    "👍 Твою рецензию на «Артист — Альбом» отметили полезной.\nВсего отметок: 5",
  );
});

Deno.test("the reaction message never names who reacted", async () => {
  const { deps, sent } = fakeDeps();
  await handleReviewReaction(
    { review_id: "rv-1", user_id: 7, username: "secret_reactor" },
    deps,
  );
  assertEquals(sent[0].text.includes("secret_reactor"), false);
});

Deno.test("your own reaction or comment never notifies you", async () => {
  const { deps, sent, claims } = fakeDeps();
  assertEquals(
    await handleReviewReaction({ review_id: "rv-1", user_id: AUTHOR }, deps),
    { status: "skipped", reason: "self" },
  );
  assertEquals(
    await handleReviewComment(
      { id: "c1", review_id: "rv-1", author_id: AUTHOR, text: "hi" },
      deps,
    ),
    { status: "skipped", reason: "self" },
  );
  assertEquals(sent.length, 0);
  assertEquals(claims.length, 0, "no cooldown is consumed by own actions");
});

Deno.test("notifications switched off means nothing is sent or claimed", async () => {
  for (const subscriber of [null, { chatId: AUTHOR, enabled: false }]) {
    const { deps, sent, claims } = fakeDeps({ subscriber });
    const result = await handleReviewReaction(
      { review_id: "rv-1", user_id: 7 },
      deps,
    );
    assertEquals(result, { status: "skipped", reason: "notifications-off" });
    assertEquals(sent.length + claims.length, 0);
  }
});

Deno.test("cooldown and repeat reactions are skipped", async () => {
  for (const decision of ["cooldown", "duplicate"] as const) {
    const { deps, sent } = fakeDeps({
      claim: { decision, previousSentAt: Date.now() },
    });
    const result = await handleReviewReaction(
      { review_id: "rv-1", user_id: 7 },
      deps,
    );
    assertEquals(result, { status: "skipped", reason: decision });
    assertEquals(sent.length, 0);
  }
});

Deno.test("a deleted review or a malformed record is ignored", async () => {
  const { deps, sent } = fakeDeps({ reviewExists: false });
  assertEquals(
    (await handleReviewReaction({ review_id: "rv-1", user_id: 7 }, deps))
      .reason,
    "review-gone",
  );
  assertEquals(
    (await handleReviewReaction({ review_id: "rv-1" }, deps)).reason,
    "no-actor",
  );
  assertEquals(
    (await handleReviewComment({ review_id: "rv-1", author_id: 7 }, deps))
      .reason,
    "no-comment",
  );
  assertEquals(sent.length, 0);
});

Deno.test("a comment names the commenter, quotes it and counts the ones held back", async () => {
  const { deps, sent, claims } = fakeDeps({
    claim: { decision: "send", previousSentAt: 1_000 },
    otherComments: 2,
  });
  const result = await handleReviewComment({
    id: "c9",
    review_id: "rv-1",
    author_id: 7,
    author_display_name: "@listener",
    text: "Согласен   про\nбас",
  }, deps);
  assertEquals(result, { status: "sent" });
  assertEquals(claims, [["rv-1", "comment", null]]);
  assertEquals(
    sent[0].text,
    "💬 Новый комментарий к твоей рецензии на «Артист — Альбом» от @listener:\n«Согласен про бас»\n\nИ ещё новых комментариев: 2",
  );
});

Deno.test("message helpers trim long text and fall back on missing data", () => {
  assertEquals(snippet("a".repeat(200)).length, 140);
  assertEquals(snippet("a".repeat(200)).endsWith("…"), true);
  assertEquals(
    buildReactionMessage(null, 0),
    "👍 Твою рецензию на «релиз» отметили полезной.\nВсего отметок: 1",
  );
  assertEquals(
    buildCommentMessage(RELEASE, "", "текст", 0),
    "💬 Новый комментарий к твоей рецензии на «Артист — Альбом» от Слушатель:\n«текст»",
  );
});
