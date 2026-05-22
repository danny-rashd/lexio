"""Run once to generate VAPID keys. Add output to your .env and Railway Variables."""
import base64

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid

vapid = Vapid()
vapid.generate_keys()

private_pem = vapid.private_pem().decode("utf-8").strip()
pub_bytes   = vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
public_b64  = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode("utf-8")

print("Add these to your .env and Railway Variables:\n")
print(f"VAPID_PRIVATE_KEY={private_pem}")
print(f"VAPID_PUBLIC_KEY={public_b64}")
