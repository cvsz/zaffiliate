BEGIN;
ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_event_type_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_type_check CHECK (
  event_type = ANY (ARRAY[
    'product_viewed','content_generated','content_approved','publication_scheduled','publication_submitted','publication_published',
    'impression_recorded','video_view_recorded','engagement_recorded','affiliate_click_recorded','redirect_completed',
    'conversion_reported','order_reported','commission_reported','refund_reported','commission_reversed','payout_reported'
  ]::text[])
);
COMMIT;
