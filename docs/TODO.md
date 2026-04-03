# TODO

- candidate prompt promotion: we should make the prompt a published artifact, and use that as baseline (also allow overriding with other versions), instead of relying on a second "baseline" copy in git.

- `system_prompt.md` contains not only the bare prompt, but also wrapper text, that is really only useful for publishing.  Make the prompt file standalone, ensure that the generated page does not break (including the copy & paste mechanism)

- check if OpenAI allows updating Custom GPT prompts via API, and do that on "deployment" (each merge to main branch kicks off deployment)

- rotate the `OPENAI_API_KEY` stored in the `openai-ci` GitHub Actions environment periodically, and immediately after any suspected exposure.

- result=PASS output from tests is buried, might be overlooked in failure output that is not relevant for the overall outcome.  make it stand out more.

- Test the capture functionality, actually
