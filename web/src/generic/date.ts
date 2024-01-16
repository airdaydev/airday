// TODO: Optimise & Test
// TODO: Component with automatic tick
export const elapsedString = (date: Date) => {
  const now = new Date();
  const diffSeconds = (now.valueOf() - date.valueOf()) / 1000;
  // seconds ago
  if (diffSeconds < 60) {
    return `a few seconds ago`;
  }
  // minutes ago (up to an hour)
  if (diffSeconds < 3600) {
    return `${(diffSeconds / 60).toFixed()} minute${diffSeconds >= 60 ? 's' : ''} ago`;
  }
  // hours ago (until 3 hours ago)
  if (diffSeconds < 3600 * 3) {
    return `${diffSeconds} ago`;
  }
  // same day
  const prevMidnight = new Date().setHours(0, 0, 0, 0);
  const secondsSinceMidnight = (new Date().valueOf() - prevMidnight.valueOf()) * 1000;
  if (diffSeconds < secondsSinceMidnight) {
    return 'today';
  }
  // yesterday
  if (diffSeconds > secondsSinceMidnight && diffSeconds < (secondsSinceMidnight + 24 * 60 * 60)) {
    return 'yesterday'
  }
  // 1 month ago (up to 3 months)
  if ((diffSeconds / 60 / 60 / 24) < 30) {
    let days = (diffSeconds / 60 / 60 / 24);
    return `${days} days ago`
  }
  // TODO: April this year
  return `${now.getMonth()} ${now.getFullYear()}`;
}
