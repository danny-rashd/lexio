import json

from pywebpush import WebPushException, webpush

from app.models.push import PushSubscription


def send_push(sub: PushSubscription, title: str, body: str, url: str = "/") -> None:
    """
    Send a Web Push notification to a single subscription.

    Args:
        sub (PushSubscription): The stored subscription record.
        title (str): Notification title shown on the device.
        body (str): Notification body text.
        url (str): URL to open when the notification is tapped.

    Returns:
        None

    Notes:
        Raises WebPushException on delivery failure. Callers should catch
        this and remove the subscription if the status is 410 (Gone),
        which means the subscription is no longer valid.
    """
    from app.config import settings

    webpush(
        subscription_info={
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        },
        data=json.dumps({"title": title, "body": body, "url": url}),
        vapid_private_key=settings.VAPID_PRIVATE_KEY.replace("\\n", "\n"),
        vapid_claims={"sub": settings.VAPID_SUBJECT},
    )
