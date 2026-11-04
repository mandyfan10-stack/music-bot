// Уведомления автору рецензии: «твою рецензию отметили полезной» и
// «новый комментарий к твоей рецензии». Логика отделена от Supabase и
// Telegram через ReviewActivityDeps, чтобы её можно было тестировать.
//
// Правила:
// - свои реакции/комментарии автору не приходят;
// - уведомления выключены в настройках → ничего не приходит;
// - по одной рецензии не чаще раза в REVIEW_ACTIVITY_COOLDOWN_SECONDS для
//   каждого вида; следующее сообщение показывает итоговое число;
// - повторная отметка от того же человека (снял и поставил) не уведомляет.
// Кто поставил реакцию, не раскрывается: в приложении это приватно.

export const REVIEW_ACTIVITY_COOLDOWN_SECONDS = 30 * 60;
const SNIPPET_MAX = 140;

export type ReviewActivityKind = "reaction" | "comment";

export type ReviewRow = {
  id: string;
  author_id: number;
  release_id: string;
  reaction_count: number;
};

export type ReleaseRow = { id: string; name: string; artist: string };

export type ClaimDecision = {
  decision: "send" | "duplicate" | "cooldown";
  previousSentAt: number | null;
};

export type ReviewActivityDeps = {
  getReview(id: string): Promise<ReviewRow | null>;
  getRelease(id: string): Promise<ReleaseRow | null>;
  getSubscriber(
    userId: number,
  ): Promise<{ chatId: number; enabled: boolean } | null>;
  claim(
    reviewId: string,
    kind: ReviewActivityKind,
    actorId: number | null,
  ): Promise<ClaimDecision>;
  countOtherCommentsSince(
    reviewId: string,
    sinceMs: number,
    excludeCommentId: string,
    reviewAuthorId: number,
  ): Promise<number>;
  sendMessage(chatId: number, text: string, releaseId: string): Promise<void>;
};

export type ReviewActivityResult = {
  status: "sent" | "skipped";
  reason?: string;
};

function releaseTitle(release: ReleaseRow | null): string {
  if (!release) return "релиз";
  const artist = String(release.artist || "").trim();
  const name = String(release.name || "").trim();
  return artist && name ? `${artist} — ${name}` : (name || artist || "релиз");
}

export function snippet(text: string, max = SNIPPET_MAX): string {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function buildReactionMessage(
  release: ReleaseRow | null,
  totalReactions: number,
): string {
  const total = Math.max(1, Math.floor(Number(totalReactions) || 0));
  return `👍 Твою рецензию на «${
    releaseTitle(release)
  }» отметили полезной.\nВсего отметок: ${total}`;
}

export function buildCommentMessage(
  release: ReleaseRow | null,
  commenter: string,
  text: string,
  otherNewComments: number,
): string {
  const who = String(commenter || "").trim() || "Слушатель";
  let message = `💬 Новый комментарий к твоей рецензии на «${
    releaseTitle(release)
  }» от ${who}:\n«${snippet(text)}»`;
  if (otherNewComments > 0) {
    message += `\n\nИ ещё новых комментариев: ${otherNewComments}`;
  }
  return message;
}

function toId(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function prepare(
  deps: ReviewActivityDeps,
  reviewId: unknown,
  actorId: number | null,
): Promise<
  | { skip: string }
  | { review: ReviewRow; chatId: number }
> {
  if (typeof reviewId !== "string" || !reviewId) {
    return { skip: "no-review-id" };
  }
  const review = await deps.getReview(reviewId);
  if (!review) return { skip: "review-gone" };
  const authorId = toId(review.author_id);
  if (!authorId) return { skip: "no-author" };
  if (actorId !== null && actorId === authorId) return { skip: "self" };
  const subscriber = await deps.getSubscriber(authorId);
  if (!subscriber || !subscriber.enabled) return { skip: "notifications-off" };
  return { review, chatId: subscriber.chatId || authorId };
}

export async function handleReviewReaction(
  record: Record<string, unknown> | null,
  deps: ReviewActivityDeps,
): Promise<ReviewActivityResult> {
  const actorId = toId(record?.user_id);
  if (!actorId) return { status: "skipped", reason: "no-actor" };
  const ready = await prepare(deps, record?.review_id, actorId);
  if ("skip" in ready) return { status: "skipped", reason: ready.skip };

  const claim = await deps.claim(ready.review.id, "reaction", actorId);
  if (claim.decision !== "send") {
    return { status: "skipped", reason: claim.decision };
  }
  const release = await deps.getRelease(ready.review.release_id);
  await deps.sendMessage(
    ready.chatId,
    buildReactionMessage(release, ready.review.reaction_count),
    ready.review.release_id,
  );
  return { status: "sent" };
}

export async function handleReviewComment(
  record: Record<string, unknown> | null,
  deps: ReviewActivityDeps,
): Promise<ReviewActivityResult> {
  const commentId = typeof record?.id === "string" ? record.id : "";
  const actorId = toId(record?.author_id);
  if (!commentId || !actorId) {
    return { status: "skipped", reason: "no-comment" };
  }
  const ready = await prepare(deps, record?.review_id, actorId);
  if ("skip" in ready) return { status: "skipped", reason: ready.skip };

  const claim = await deps.claim(ready.review.id, "comment", null);
  if (claim.decision !== "send") {
    return { status: "skipped", reason: claim.decision };
  }
  const others = claim.previousSentAt
    ? await deps.countOtherCommentsSince(
      ready.review.id,
      claim.previousSentAt,
      commentId,
      Number(ready.review.author_id),
    )
    : 0;
  const release = await deps.getRelease(ready.review.release_id);
  await deps.sendMessage(
    ready.chatId,
    buildCommentMessage(
      release,
      String(record?.author_display_name || ""),
      String(record?.text || ""),
      others,
    ),
    ready.review.release_id,
  );
  return { status: "sent" };
}
