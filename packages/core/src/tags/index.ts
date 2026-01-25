/**
 * Tag management module.
 *
 * Provides utilities for mapping message categories to Front tags
 * with caching and auto-creation.
 */

export {
  TagRegistry,
  createTagRegistry,
  DEFAULT_CATEGORY_TAG_MAPPING,
  type TagRegistryOptions,
} from './registry'
