create index if not exists alipay_orders_status_created_at_idx
on public.alipay_orders(status, created_at desc);

update public.alipay_orders
set status = 'expired'
where status = 'pending'
  and created_at < now() - interval '30 minutes';
