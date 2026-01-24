.ONESHELL:

DEBUG    ?= false
VERBOSE  ?= false

ifeq ($(DEBUG),true)
    MAKEFLAGS += --debug=v
    RM_FLAGS = -v
else
    ifeq ($(VERBOSE),true)
        MAKEFLAGS += --verbose
        RM_FLAGS := -v
    else
        MAKEFLAGS += --silent
    endif
endif

RM_FLAGS := -rf$(if $(or $(DEBUG),$(VERBOSE)),v,)
RM := rm $(RM_FLAGS)

PRECOMMIT ?= pre-commit
ifneq ($(shell command -v prek >/dev/null 2>&1 && echo y),)
    PRECOMMIT := prek
    ifneq ($(filter true,$(DEBUG) $(VERBOSE)),)
        $(info Using prek for pre-commit checks)
        ifeq ($(DEBUG),true)
            PRECOMMIT := $(PRECOMMIT) -v
        endif
    endif
endif

# Terminal formatting (tput with fallbacks to ANSI codes)
_COLOR  := $(shell tput sgr0 2>/dev/null || printf '\033[0m')
BOLD    := $(shell tput bold 2>/dev/null || printf '\033[1m')
CYAN    := $(shell tput setaf 6 2>/dev/null || printf '\033[0;36m')
GREEN   := $(shell tput setaf 2 2>/dev/null || printf '\033[0;32m')
YELLOW  := $(shell tput setaf 3 2>/dev/null || printf '\033[0;33m')

.DEFAULT_GOAL := help
.PHONY: help
help: ## Show this help message
	@echo "$(BOLD)Available targets:$(_COLOR)"
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
        awk 'BEGIN {FS = ":.*?## "; max = 0} \
            {if (length($$1) > max) max = length($$1)} \
            {targets[NR] = $$0} \
            END {for (i = 1; i <= NR; i++) { \
                split(targets[i], arr, FS); \
                printf "$(CYAN)%-*s$(_COLOR) %s\n", max + 2, arr[1], arr[2]}}'
	@echo
	@echo "$(BOLD)Environment variables:$(_COLOR)"
	@echo "  $(YELLOW)DEBUG$(_COLOR) = true|false    Set to true to enable debug output (default: false)"
	@echo "  $(YELLOW)VERBOSE$(_COLOR) = true|false  Set to true to enable verbose output (default: false)"

#######################
## Build and install ##
#######################

.PHONY: install
install: ## Install npm dependencies
	npm install

.PHONY: develop
WITH_HOOKS ?= true
develop: install ## Set up for development (WITH_HOOKS={true|false}, default=true)
	@if [ "$(WITH_HOOKS)" = "true" ]; then \
        $(MAKE) enable-pre-commit; \
    fi

.PHONY: build
build: install ## Build the action with ncc
	npm run build

.PHONY: rebuild
rebuild: clean build ## Clean and build from scratch

.PHONY: release
release: ## Create a GitHub release (VERSION=vX.Y.Z)
	@if [ -z "$(VERSION)" ]; then echo "Usage: make release VERSION=vX.Y.Z"; exit 1; fi
	@git rev-parse --verify refs/tags/$(VERSION) >/dev/null 2>&1 || { echo "Error: Tag $(VERSION) does not exist"; exit 1; }
	gh release create $(VERSION) --generate-notes

#############
## Testing ##
#############

.PHONY: test
test: ## Run tests once
	npm run test

.PHONY: test-watch
test-watch: ## Run tests in watch mode
	npm run test:watch

.PHONY: lint
lint: ## Run ESLint
	npm run lint

.PHONY: type-check
type-check: ## Run TypeScript type checking
	npm run type-check

.PHONY: check
check: install run-pre-commit lint type-check test ## Run all checks (lint, type-check, tests)

.PHONY: clean
TO_REMOVE := \
    coverage \
    dist \
    node_modules
clean: ## Remove build artifacts and temporary files
	@echo $(TO_REMOVE) | xargs -n 1 -P 3 $(RM)

######################
## Pre-commit hooks ##
######################

.PHONY: enable-pre-commit
enable-pre-commit: ## Enable pre-commit hooks (along with commit-msg and pre-push hooks)
	@if command -v pre-commit >/dev/null 2>&1; then \
        pre-commit install; \
    else \
        echo "$(YELLOW)Warning: pre-commit is not installed. Skipping hook installation.$(_COLOR)"; \
        echo "Install it with: pip install pre-commit (or brew install pre-commit on macOS)"; \
    fi

.PHONY: disable-pre-commit
disable-pre-commit: ## Disable pre-commit hooks (removes commit-msg, pre-commit, pre-push, and prepare-commit-msg hooks)
	@if command -v pre-commit >/dev/null 2>&1; then \
        $(UV) run pre-commit uninstall; \
        echo "$(BOLD)$(GREEN)Pre-commit hooks disabled.$(_COLOR)"; \
    else \
        echo "$(YELLOW)Warning: pre-commit is not installed. Nothing to disable.$(_COLOR)"; \
    fi

.PHONY: run-pre-commit
run-pre-commit: ## Run the pre-commit checks
	$(PRECOMMIT) run --all-files
