---
title: Strava Coach
permalink: /
layout: page
---

This site publishes the public assets for the open-source `Strava Coach` Custom GPT.

## Public Documents

- [README](./README.md)
- [Privacy Policy](./privacy-policy/)
- OpenAPI specs are published as direct file URLs under `./actions/`

## OpenAPI Spec Links

{% assign pages_origin = 'https://michaelw.github.io/strava-coach' %}
{% if site.github and site.github.owner_name and site.github.repository_name %}
	{% assign pages_origin = 'https://' | append: site.github.owner_name | append: '.github.io/' | append: site.github.repository_name %}
{% endif %}

{% assign action_files = site.static_files | sort: 'path' %}
{% assign has_specs = false %}
{% for file in action_files %}
	{% if file.path contains '/actions/' %}
		{% if file.name contains '.openapi.' %}
			{% if file.extname == '.yaml' or file.extname == '.yml' or file.extname == '.json' %}
				{% assign has_specs = true %}
				{% assign spec_url = pages_origin | append: file.path %}
- [{{ spec_url }}]({{ spec_url }})
			{% endif %}
		{% endif %}
	{% endif %}
{% endfor %}
{% unless has_specs %}
- No OpenAPI spec files found in `actions/`.
{% endunless %}
