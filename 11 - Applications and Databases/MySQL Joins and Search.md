# MySQL Joins and Search

## Concept

A join combines rows from two tables on a key. A search is a `WHERE` that should hit an index. Most production pain is not “I forgot the syntax”. It is joining the wrong column, turning one row into thousands, or searching with a pattern the index cannot use.

Do data changes in a transaction. See also [[Database Operational Basics]] and [[Database Backup and Restore]].

## Why it matters

- Support tickets are “show me this customer and their last 20 orders” — that is a join plus a filter
- A missing join condition is a cartesian product. It looks like the database hung
- `LEFT JOIN` then `WHERE right.id = …` quietly turns into an inner join and “missing” rows vanish
- `LIKE '%foo%'` will table-scan. Fine on 2k rows, deadly on 20M
- `EXPLAIN` is how you prove the query will not take the site down

## Mental Model

```
orders.customer_id  →  customers.id     INNER: only matches
                                        LEFT:  all orders, customer cols NULL if orphan

Filter early (WHERE on the driving table)
Join on the *id*, not on the display name
LIMIT after you know the join is correct
```

Join types you actually use:

- `INNER JOIN` — row must exist on both sides
- `LEFT JOIN` — keep the left row even if the right side is missing
- Avoid `RIGHT JOIN`; rewrite as `LEFT`
- Never `CROSS JOIN` in prod unless you can say why

Search that can use an index: `=`, `IN (...)`, `>`, `<`, `LIKE 'foo%'`, covering columns left-to-right in a composite index.

Search that usually cannot: `LIKE '%foo%'`, `OR` across unrelated columns, wrapping the column in a function (`DATE(created_at) = …`).

## Key Commands

```sql
-- Shape of the tables
SHOW TABLES;
DESCRIBE customers;
DESCRIBE orders;
SHOW INDEX FROM orders;

-- Safe session for poking prod-like data
SET SESSION sql_safe_updates = 1;
SELECT DATABASE();

-- Inner join: orders that have a customer
SELECT o.id, o.total, c.email
FROM orders o
INNER JOIN customers c ON c.id = o.customer_id
WHERE o.created_at >= '2026-09-01'
ORDER BY o.id DESC
LIMIT 50;

-- Left join: orders including orphans
SELECT o.id, o.customer_id, c.email
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
WHERE c.id IS NULL
LIMIT 50;

-- Search
SELECT id, email FROM customers WHERE email = 'user@example.com';
SELECT id, email FROM customers WHERE email LIKE 'user%';      -- can use index
SELECT id, email FROM customers WHERE email LIKE '%example.com'; -- usually cannot

-- Prove it
EXPLAIN SELECT o.id
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.email = 'user@example.com';
```

```bash
# From the host
mysql -h 127.0.0.1 -u app -p appdb
# or
mysql --defaults-file=/root/.my.cnf -e 'SHOW PROCESSLIST\G'
```

Before an `UPDATE` that uses the same join:

```sql
START TRANSACTION;
SELECT COUNT(*) FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.email = 'user@example.com';
-- only then UPDATE ... and check ROW_COUNT();
-- COMMIT;  or  ROLLBACK;
```

## Common Failure Modes & Symptoms

| Symptom | Likely cause | First checks |
|---------|--------------|--------------|
| Query “hangs” | Forgotten join clause / cartesian | `EXPLAIN`, `COUNT(*)` without LIMIT |
| Rows missing | `WHERE` on the right side of a `LEFT JOIN` | Move that predicate into `ON` |
| Duplicate rows | One-to-many joined without aggregation | `GROUP BY` or pick one child with a subquery |
| Full table scan | Leading `%` LIKE, function on column | `SHOW INDEX`, rewrite the predicate |
| Wrong customer | Joined on `name` not `id` | Inspect `ON` |
| Works in staging | Missing index in prod, different charset | `SHOW INDEX`, `EXPLAIN` in *prod read replica* |
| Safe-updates error | `UPDATE`/`DELETE` without key in `WHERE` | That is a feature; add the key |

## Investigation Tips

- Run `EXPLAIN` before you run the unbounded `SELECT` on prod. `type=ALL` on a big table is a page.
- `SELECT COUNT(*)` the join in a transaction before any write.
- Prefer a replica for ad-hoc search. If you must use primary, `LIMIT` first.
- `OR` across two columns often disables indexes. `UNION` of two indexed seeks can be cheaper.
- Collation mismatches (`utf8mb4_general_ci` vs `_bin`) make `=` miss rows you can see with `LIKE`.
- If the app search is slow, copy the *exact* SQL from `SHOW PROCESSLIST` or the slow log. Do not rewrite from memory.

## Related Notes

- [[Database Operational Basics]]
- [[Database Backup and Restore]]
- [[Connection Exhaustion]]
- [[Performance Investigation Framework]]
- [[Troubleshooting Methodology]]

## Personal Lessons Learned

- A “simple email lookup” was `LIKE '%@domain%'` on 8M rows with no index. `email =` plus a unique index turned a 12s stall into 2ms.
- I have dropped rows from a report by putting `t2.status = 'active'` in `WHERE` after a `LEFT JOIN t2`. Those filters belong in `ON` if you still want the left row.
- Joining `users.name` because “there is no user_id on this legacy table” produced duplicate invoices for every homonym. Add the key; do not join on the label.
