/**
 * News Injector
 * Allows injecting breaking news or regular news into the podcast
 */

export class NewsInjector {
  constructor() {
    this.breakingNews = [];
    this.regularNews = [];
  }

  /**
   * Inject breaking news - agents will immediately start talking about it
   * @param {string} news - The breaking news to inject
   */
  injectBreakingNews(news) {
    console.log(`\n🚨 BREAKING NEWS: ${news}\n`);
    this.breakingNews.push({
      content: news,
      timestamp: Date.now(),
      discussed: false
    });
  }

  /**
   * Inject regular news - agents might talk about it later
   * @param {string} news - The regular news to inject
   */
  injectRegularNews(news) {
    console.log(`\n📰 NEWS: ${news}\n`);
    this.regularNews.push({
      content: news,
      timestamp: Date.now(),
      discussed: false
    });
  }

  /**
   * Get the next breaking news item
   * @returns {object|null}
   */
  getNextBreakingNews() {
    const undiscussed = this.breakingNews.filter(n => !n.discussed);
    if (undiscussed.length > 0) {
      const news = undiscussed[0];
      news.discussed = true;
      return news;
    }
    return null;
  }

  /**
   * Get all regular news (for context)
   * @returns {array}
   */
  getRegularNews() {
    return this.regularNews.filter(n => !n.discussed);
  }

  /**
   * Mark a regular news item as discussed
   * @param {number} index
   */
  markRegularNewsDiscussed(index) {
    if (this.regularNews[index]) {
      this.regularNews[index].discussed = true;
    }
  }

  /**
   * Check if there's breaking news
   * @returns {boolean}
   */
  hasBreakingNews() {
    return this.breakingNews.some(n => !n.discussed);
  }

  /**
   * Get a prompt for breaking news
   * @param {object} news
   * @returns {string}
   */
  getBreakingNewsPrompt(news) {
    return `BREAKING NEWS just came in: "${news.content}". React to this news immediately and discuss it with the other hosts.`;
  }

  /**
   * Get a prompt that includes regular news context
   * @returns {string}
   */
  getRegularNewsContext() {
    const news = this.getRegularNews();
    if (news.length === 0) return '';
    
    const newsItems = news.map(n => n.content).join('; ');
    return `\n\nRecent news you might want to reference: ${newsItems}`;
  }
}
