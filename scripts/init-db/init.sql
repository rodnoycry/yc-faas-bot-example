CREATE TABLE IF NOT EXISTS messages
(
    chat_id Int64 NOT NULL,
    created_at Timestamp NOT NULL,
    id Utf8 NOT NULL,
    role Utf8 NOT NULL,
    content Utf8 NOT NULL,
    PRIMARY KEY (chat_id, created_at, id)
);
