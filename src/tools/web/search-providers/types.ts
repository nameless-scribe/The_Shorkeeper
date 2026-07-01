export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
  datePublished?: string;
}

export interface WebSearchProviderResult {
  items: WebSearchResultItem[];
  provider: string;
}

export interface WebSearchProvider {
  name: string;
  search(query: string, signal: AbortSignal): Promise<WebSearchProviderResult>;
}
