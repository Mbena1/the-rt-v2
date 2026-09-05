/*
# Add increment_x_account_counter function

Adds a SECURITY DEFINER function to atomically increment daily and total counters
on x_accounts. Used by the queue-processor edge function after successful actions.
*/

CREATE OR REPLACE FUNCTION increment_x_account_counter(
  p_account_id uuid,
  p_counter text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_counter = 'retweets_today' THEN
    UPDATE x_accounts SET retweets_today = retweets_today + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'retweets_total' THEN
    UPDATE x_accounts SET retweets_total = retweets_total + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'likes_today' THEN
    UPDATE x_accounts SET likes_today = likes_today + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'likes_total' THEN
    UPDATE x_accounts SET likes_total = likes_total + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'replies_today' THEN
    UPDATE x_accounts SET replies_today = replies_today + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'replies_total' THEN
    UPDATE x_accounts SET replies_total = replies_total + 1, updated_at = now() WHERE id = p_account_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_x_account_counter(uuid, text) TO authenticated;
