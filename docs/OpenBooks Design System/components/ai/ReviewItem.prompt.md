The Inbox unit — AI asks the owner to resolve one uncertain transaction.

```jsx
<ReviewItem
  counterparty="Wise transfer"
  date="Jun 5"
  account="Mercury Checking"
  amount={-1850}
  question="I wasn't sure if this is contractor delivery labor or an owner reimbursement — you've used both for Wise before."
  options={["Contractor labor", "Owner reimbursement", "Something else"]}
  onChoose={(c) => …}
/>
```

The question is the only place AI speaks in first person. It always explains *why* it's uncertain. Choosing an option should feel one-tap; "Skip for now" is always available.
