---
title: ChatGPT Setup
permalink: /setup/chatgpt/
layout: page
---

This guide covers the ChatGPT-side configuration for the `Strava Coach` GPT and the matching OAuth app setup in Strava.

## 1. Create a Strava API Application

In the Strava developer settings, create a new API application and record the generated client credentials.

- Create the app in the [Strava API settings](https://www.strava.com/settings/api)
- Save the `Client ID`
- Save the `Client Secret`
- Set the authorization callback domain or URL to `chat.openai.com`

<figure class="doc-figure doc-figure--wide">
  <img
    src="{{ '/assets/strava-app-setup.png' | relative_url }}"
    alt="Strava API application setup screenshot"
  >
  <figcaption>Strava API application settings</figcaption>
</figure>

The callback setting must allow ChatGPT to complete the OAuth redirect flow.

## 2. Create the GPT Action in ChatGPT

Inside the GPT builder:

1. Open your GPT.
2. Go to the `Actions` section.
3. Create the Strava action.
4. Import or paste the Strava OpenAPI schema from this repository.

If this site is published through GitHub Pages, the action spec URL is typically:

[{{ '/actions/strava.openapi.yaml' | absolute_url }}]({{ '/actions/strava.openapi.yaml' | relative_url }})

## 3. Add the System Prompt to GPT Instructions

In the GPT builder, open `Configure` and paste the Strava Coach system prompt into the GPT's `Instructions` field.

- Use the copy-ready prompt from [System Prompt]({{ '/system-prompt/' | relative_url }})
- Paste it into `Instructions` exactly as written
- Save the GPT configuration after pasting

Without this step, the action may connect successfully but the coaching behavior will not match this project.

## 4. Configure OAuth Authentication

Choose `OAuth` as the authentication type and enter these values exactly:

| Setting | Value |
| --- | --- |
| Client ID | Your Strava `Client ID` |
| Client Secret | Your Strava `Client Secret` |
| Authorization URL | `https://www.strava.com/oauth/authorize` |
| Token URL | `https://www.strava.com/api/v3/oauth/token` |
| Scope | `read,read_all,activity:read,profile:read_all` |
| Token Exchange Method | `Default (POST request)` |

<figure class="doc-figure doc-figure--medium">
  <img
    src="{{ '/assets/chatgpt-action-oauth-setup.png' | relative_url }}"
    alt="ChatGPT action OAuth setup screenshot"
  >
  <figcaption>ChatGPT action OAuth configuration</figcaption>
</figure>

## 5. Keep Instructions Updated Later

When `system_prompt.md` changes in this repository, update your Custom GPT:

1. Re-open your GPT in ChatGPT.
2. Copy the latest prompt again from [System Prompt]({{ '/system-prompt/' | relative_url }}).
3. Replace the full `Instructions` text.
4. Save and republish the GPT.

Tip: treat `system_prompt.md` as the source of truth and do a full replace rather than partial edits.

## 6. Final Check

Before saving, confirm:

- the Strava app callback points to `chat.openai.com`
- the ChatGPT action is using OAuth
- the client ID and secret come from the same Strava app
- the OAuth scope string matches exactly
- the token exchange method remains `Default (POST request)`
- the latest system prompt text is pasted into GPT `Instructions`

Once saved, ChatGPT should prompt the user to connect their Strava account during action authentication.
