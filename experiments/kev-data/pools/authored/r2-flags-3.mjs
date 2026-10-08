// train-pools, R2 top-up 3 (see r2-flags.mjs): template 5 (finance still invoices / nobody ever bought).
export default {
  paraphrase: {
    '5': [
      '<<The fact that finance still sends invoices to rows marked {token} proves they are not void.|The fact that nobody ever placed an order through a row marked {token} proves it is void.>>',
      '<<Rows marked {token} are still on finance\'s billing list, which means they are not void.|A row marked {token} never appeared in any order, which means it is void.>>',
      'Whether rows marked {token} are void is settled by <<finance still invoicing them|the absence of any purchase made through them>>: <<they are not void|it is void>>.',
      '<<Finance goes on billing rows marked {token}; none of them is void.|Nobody has ever bought through a row marked {token}; it is void.>>',
      '<<Still invoiced by finance, rows marked {token} cannot be void.|Never used for a single purchase, a row marked {token} can only be void.>>',
      'A row marked {token} that <<finance keeps invoicing is live, not void|has never been used to buy anything is void, not live>>.',
      '<<Because invoices still go out for rows marked {token}, they are live rows.|Because no customer ever bought through a row marked {token}, it is a void row.>>',
      '<<Billing for rows marked {token} has never stopped at finance, so they are not void.|Purchases through a row marked {token} have never happened, so it is void.>>',
      '<<The reason these rows are not void: finance still invoices every row marked {token}.|The reason this row is void: nobody has ever bought anything through a row marked {token}.>>',
      '<<Finance treats rows marked {token} as customers and invoices them, so they are not void.|Nobody treats a row marked {token} as a customer, since it has never bought anything, so it is void.>>',
      'Finance <<still invoices rows marked {token}, which tells you that they are real and not void|has no invoices for a row marked {token}, because nobody ever bought through it, which tells you that it is void>>.',
      '<<Rows marked {token} are billed by finance to this day and are not void.|A row marked {token} has never been billed to anyone and is void.>>',
    ],
  },
};
