"use client";

export const PLAID_OAUTH_LINK_TOKEN_KEY = "openbooks:plaid-link-token";
export const PLAID_OAUTH_ENTITY_ID_KEY = "openbooks:plaid-entity-id";

export function storePlaidOAuthSession(args: { linkToken: string; entityId: string }) {
  window.localStorage.setItem(PLAID_OAUTH_LINK_TOKEN_KEY, args.linkToken);
  window.localStorage.setItem(PLAID_OAUTH_ENTITY_ID_KEY, args.entityId);
}

export function readPlaidOAuthSession() {
  return {
    linkToken: window.localStorage.getItem(PLAID_OAUTH_LINK_TOKEN_KEY),
    entityId: window.localStorage.getItem(PLAID_OAUTH_ENTITY_ID_KEY),
  };
}

export function clearPlaidOAuthSession() {
  window.localStorage.removeItem(PLAID_OAUTH_LINK_TOKEN_KEY);
  window.localStorage.removeItem(PLAID_OAUTH_ENTITY_ID_KEY);
}
