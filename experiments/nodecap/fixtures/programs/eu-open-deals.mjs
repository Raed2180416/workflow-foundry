// Fixture program capability (CM0, development fixture): one typed call that pages the CRM deal list and sums the open deals of a region,
// where a tool node would spend a model turn per page. It may call only the members its catalog entry lists in `uses`.
export default async function main(input, { call }) {
  let total = 0, count = 0, pages = 1;
  for (let page = 1; page <= pages; page++) {
    const result = await call('mcp.crm.list_deals', { page });
    pages = Math.min(result.pages, 5);
    for (const deal of result.deals) if (deal.region === input.region && deal.status === 'open') { total += deal.amount; count += 1; }
  }
  return { total, count };
}
