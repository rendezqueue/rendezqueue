# Rendezqueue Client Protocol Guide

This document summarizes the key principles and state management logic required for a client to correctly interact with the Rendezqueue server protocol. This guide was distilled from a detailed, collaborative testing session.

## Core Concepts

The Rendezqueue protocol is stateful and revolves around three key concepts:

1.  **Key:** A shared string that identifies a "room" or a channel where two or more clients can meet to exchange data.
2.  **Session ID (`sid`):** A unique identifier for a client's participation in a single exchange.
3.  **Offset:** An integer that tracks the number of values a client has successfully sent in the current session.

It is important to note that an exchange is always between **exactly two parties**.

## The Session Lifecycle

The most critical concept to understand is the **session lifecycle**. A session is not permanent; it effectively ends after one successful exchange of values.

1.  **Initiating a Session:** A client starts a new session by sending a request with a new, unique `sid`. It is recommended to use a format like `<hue>-<counter>`, e.g., `Alice-1`. The initial `offset` for a new session is always `0`.

2.  **Making an Offer:** When a client sends a request with one or more `values`, it creates an "unmatched offer" on the server, associated with its `key` and `sid`.
    -   The client can append more values to its offer by sending subsequent requests with the same `sid` and an updated `offset` that reflects the total number of values sent so far in that session.

3.  **The Swap (Exchange):** A swap occurs when a second client sends a request with the same `key` but a different `sid`. This matches the first client's offer.
    -   The second client immediately receives the first client's offered values in the response.
    -   The first client will receive the second client's values the next time it polls the server with its original `sid`.

4.  **Identifying and Ending a Session:** A client knows an exchange has occurred (and thus its session has ended) if the response from the server:
    -   Contains a non-empty `values` array.
    -   OR has a non-zero `offset` and an absent `ttl` field. The `ttl` is absent for any completed exchange.

    The moment a client detects these conditions, its current session is considered complete.

5.  **Starting a New Session:** To send or receive more messages after a session has ended, the client **must** start a new session. This involves:
    -   Generating a new, unique `sid` (e.g., incrementing the counter to `Alice-2`).
    -   Resetting its internal `offset` back to `0` for the new session.

## `offset` Handling Details

The `offset` is a crucial part of the protocol that was a source of much confusion. Here's how it works:

-   **In a `request`:** The `offset` tells the server how many values the client has already sent *in the current session*. When appending to an offer, the client sends `offset: <current_number_of_sent_values>`.
-   **In a `response`:** The `offset` sent back by the server is an echo of the number of values it just processed from the client's request. For example, if a client sends a request with one new value, the server responds with `offset: 1`. If the client polls with an empty `values` array, the server responds with `offset: 0` (which is usually omitted from the final JSON).
-   **Client-side `offset` management:** The client is solely responsible for maintaining its internal `offset` counter. The `offset` in the server's response should be used to confirm that the server has received the sent messages. The client's internal `offset` for the *next* request should be based on the total number of values it has sent in the current session.

## Graceful Rejection

A key feature of the protocol is how it handles attempts to send new data using an old, already-swapped `sid`.

-   If a client tries to send a new value with a `sid` that has already completed an exchange, the server will **not** return a 404 error.
-   Instead, it will return the pending values from the completed swap, but it will **not** increment the `offset` in its response. This signals to the client that its new value was not accepted and that it must start a new session to send it. A robust client should then automatically re-send the rejected value on the new session.
