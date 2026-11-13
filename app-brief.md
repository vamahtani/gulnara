# Gulnara product contract

Gulnara is a floral studio design prototype with a curated collection,
personalization and bouquet inspiration. The maintained UI includes theme
selection, representative floral photography, collection filtering/sorting,
occasion/mood/palette/size preferences, and an optional semantic finder.

Offline compositions and prices are illustrative and unbookable. Real stock,
prices, customer fulfillment and payment processing are not configured by this
source handoff. No real customer or booking records are included.

The protected booking architecture uses external OIDC authorization-code flow
with PKCE, API access-token validation, DAB, and SQL owner-context enforcement.
Bookings require authenticated identity and real operator-configured inventory.
SQL handles inventory concurrency and idempotent request retries.

The optional semantic-search demonstration uses Azure OpenAI embeddings and
native Azure SQL cosine/DiskANN search. Readiness, input limits, processing
acknowledgement and cumulative spending guards are part of the implementation.
Inspiration is not a claim of stock, an exact recipe, or availability.

This handoff authorizes source sharing only. Cloud provisioning, identity
registration, model calls, database modifications, live business enablement and
access to another person's resources require separate approval.
