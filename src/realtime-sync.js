// Разбор событий Supabase Realtime (postgres_changes) в действия для
// app.js. Чистая функция без сети и DOM: что именно изменилось и касается
// ли это текущего пользователя. app.js выполняет действия — применяет
// дельту, дозапрашивает строку из view или обновляет личные наборы.
//
// Действия:
//   { kind: 'delta', delta }              — applySyncDelta(delta)
//   { kind: 'refetch-review', id }        — перечитать строку reviews_view
//   { kind: 'refetch-comment', id }       — перечитать строку comments_view
//   { kind: 'own-like', eventType, id }   — свой лайк релиза
//   { kind: 'own-reaction', eventType, id } — своя реакция на рецензию
//   { kind: 'blocked', on, userId, username, isMe } — блокировка

const REALTIME_TABLES = ['releases', 'reviews', 'review_comments', 'likes', 'review_reactions', 'blocked_users'];

function rowOf(payload) {
  return (payload && (payload.new && Object.keys(payload.new).length ? payload.new : payload.old)) || {};
}

function isUpsert(payload) {
  return payload && (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE');
}

function isOwnRow(row, currentUserId) {
  if (currentUserId == null || currentUserId === '' || row.user_id == null) return false;
  return String(row.user_id) === String(currentUserId);
}

function describeRealtimeChange(table, payload, currentUserId) {
  if (!payload || !payload.eventType) return [];
  const isDelete = payload.eventType === 'DELETE';
  const row = rowOf(payload);

  switch (table) {
    case 'releases':
      if (isUpsert(payload) && payload.new) return [{ kind: 'delta', delta: { releases: [payload.new] } }];
      if (isDelete && row.id) return [{ kind: 'delta', delta: { deletedReleaseIds: [row.id] } }];
      return [];

    case 'reviews':
      if (isUpsert(payload) && row.id) return [{ kind: 'refetch-review', id: row.id }];
      if (isDelete && row.id) return [{ kind: 'delta', delta: { deletedReviewIds: [row.id] } }];
      return [];

    case 'review_comments':
      if (isUpsert(payload) && row.id) return [{ kind: 'refetch-comment', id: row.id }];
      if (isDelete && row.id) return [{ kind: 'delta', delta: { deletedCommentIds: [row.id] } }];
      return [];

    case 'likes':
      if (!row.release_id || !isOwnRow(row, currentUserId)) return [];
      return [{ kind: 'own-like', eventType: payload.eventType, id: row.release_id }];

    case 'review_reactions': {
      if (!row.review_id) return [];
      // Счётчик реакций видят все — рецензию перечитываем при любой реакции.
      const actions = [{ kind: 'refetch-review', id: row.review_id }];
      if (isOwnRow(row, currentUserId)) {
        actions.push({ kind: 'own-reaction', eventType: payload.eventType, id: row.review_id });
      }
      return actions;
    }

    case 'blocked_users':
      if (payload.eventType !== 'INSERT' && !isDelete) return [];
      if (row.user_id == null) return [];
      return [{
        kind: 'blocked',
        on: payload.eventType === 'INSERT',
        userId: String(row.user_id),
        username: row.username || '',
        isMe: isOwnRow(row, currentUserId)
      }];

    default:
      return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { REALTIME_TABLES, describeRealtimeChange };
}
