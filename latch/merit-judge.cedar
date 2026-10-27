// merit-judge: the Messages API only, POST only, with a body,
// from a caller that names its campaign.
permit (
  principal,
  action == Action::"POST",
  resource == Endpoint::"/v1/messages"
)
when { context.hasBody };

// Merit sends X-User with the same value as X-Merit-Campaign. Without it,
// Latch's principal is User::"anonymous", and the call is refused.
forbid (principal == User::"anonymous", action, resource);
