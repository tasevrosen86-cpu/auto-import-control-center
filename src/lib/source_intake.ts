export type IntakeSourceType = 'encar' | 'autotrader_ca' | 'other';

export type SourceIntake = {
  sourceType: IntakeSourceType;
  sourceUrl: string;
  sourceDomain: string;
  sourceListingId: string | null;
  sourceLabel: string;
};

export function analyzeSourceUrl(rawUrl: string): SourceIntake {
  const sourceUrl = rawUrl.trim();
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error('Линкът не е валиден URL адрес.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Позволени са само интернет адреси с http или https.');
  }

  const sourceDomain = url.hostname.toLowerCase().replace(/^www\./, '');

  if (sourceDomain === 'encar.com' || sourceDomain.endsWith('.encar.com')) {
    const sourceListingId = url.pathname.match(/(?:cars\/detail|detail)\/(\d+)/i)?.[1] ?? null;
    return { sourceType: 'encar', sourceUrl, sourceDomain, sourceListingId, sourceLabel: 'Encar Korea' };
  }

  if (sourceDomain === 'autotrader.ca' || sourceDomain.endsWith('.autotrader.ca')) {
    const sourceListingId = url.pathname.match(/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/i)?.[1]
      ?? url.searchParams.get('id')
      ?? null;
    return { sourceType: 'autotrader_ca', sourceUrl, sourceDomain, sourceListingId, sourceLabel: 'AutoTrader Canada' };
  }

  return { sourceType: 'other', sourceUrl, sourceDomain, sourceListingId: null, sourceLabel: sourceDomain };
}
