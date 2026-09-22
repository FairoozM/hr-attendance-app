'use strict'

/**
 * Infer Kitchen / Kitchen & Dining relevance for Amazon product types.
 *
 * Amazon Product Type Definitions API does not return an official category-tree
 * membership field. When schemas include recommended_browse_nodes enumNames,
 * those labels are treated as the strongest available official Amazon evidence.
 */

/** @typedef {'exact'|'high'|'medium'|'low'} Confidence */
/** @typedef {{ is_kitchen: boolean, kitchen_section: string, confidence: Confidence|'', classification_source: string, classification_reason: string }} Classification */

const EXACT_TYPE_SECTIONS = {
  COOKWARE_SET: 'Cookware sets',
  COOKING_POT: 'Pots and pans',
  SAUTE_FRY_PAN: 'Frying, sauté and grill pans',
  FRYING_PAN: 'Frying, sauté and grill pans',
  GRILL_PAN: 'Frying, sauté and grill pans',
  WOK: 'Pots and pans',
  PRESSURE_COOKER: 'Pressure cookers',
  STOVETOP_KETTLE: 'Kettles',
  ELECTRIC_KETTLE: 'Kettles',
  ELECTRIC_WATER_BOILER: 'Kettles',
  BAKEWARE: 'Bakeware',
  BAKING_PAN: 'Bakeware',
  BAKING_SHEET: 'Bakeware',
  BAKING_CUP: 'Baking tools and moulds',
  BAKING_MAT: 'Baking tools and moulds',
  KITCHEN_KNIFE: 'Knives and cutting accessories',
  CUTTING_BOARD: 'Knives and cutting accessories',
  KITCHEN_TOOLS: 'Kitchen utensils and gadgets',
  KITCHEN_UTENSIL: 'Kitchen utensils and gadgets',
  FOOD_STORAGE_CONTAINER: 'Food storage',
  DRINKING_CUP: 'Drinkware',
  DISHWARE_PLATE: 'Dinnerware',
  DISHWARE_BOWL: 'Dinnerware',
  SERVING_TRAY: 'Serveware',
  THERMOS: 'Vacuum flasks and thermoses',
  VACUUM_FLASK: 'Vacuum flasks and thermoses',
  COOKWARE: 'Cookware',
  ROASTING_PAN: 'Pots and pans',
  DUTCH_OVEN: 'Pots and pans',
  STOCKPOT: 'Pots and pans',
  SAUCEPAN: 'Pots and pans',
  CASSEROLE_DISH: 'Cookware',
  STEAMER: 'Cookware',
  MANDOLINE: 'Food preparation',
  KITCHEN_SHEARS: 'Knives and cutting accessories',
  KNIFE_BLOCK: 'Knives and cutting accessories',
  KNIFE_SET: 'Knives and cutting accessories',
  FLATWARE: 'Flatware and cutlery',
  CUTLERY: 'Flatware and cutlery',
  DINNERWARE_SET: 'Dinnerware',
  SERVING_BOWL: 'Serveware',
  SERVING_PLATTER: 'Serveware',
  SERVING_UTENSIL: 'Serveware',
  BARWARE: 'Barware',
  COCKTAIL_SHAKER: 'Barware',
  WINE_GLASS: 'Drinkware',
  MUG: 'Drinkware',
  TUMBLER: 'Drinkware',
  TEA_POT: 'Tea and coffee accessories',
  TEAPOT: 'Tea and coffee accessories',
  COFFEE_POT: 'Tea and coffee accessories',
  FRENCH_PRESS: 'Tea and coffee accessories',
  COFFEE_FILTER: 'Tea and coffee accessories',
  KITCHEN_TOWEL: 'Kitchen linen',
  OVEN_MITT: 'Kitchen linen',
  APRON: 'Kitchen linen',
  PLACE_MAT: 'Kitchen linen',
  TABLECLOTH: 'Kitchen linen',
  NAPKIN: 'Kitchen linen',
  FOOD_PROCESSOR: 'Relevant small kitchen appliances',
  BLENDER: 'Relevant small kitchen appliances',
  MIXER: 'Relevant small kitchen appliances',
  STAND_MIXER: 'Relevant small kitchen appliances',
  HAND_MIXER: 'Relevant small kitchen appliances',
  TOASTER: 'Relevant small kitchen appliances',
  TOASTER_OVEN: 'Relevant small kitchen appliances',
  MICROWAVE_OVEN: 'Relevant small kitchen appliances',
  SLOW_COOKER: 'Relevant small kitchen appliances',
  RICE_COOKER: 'Relevant small kitchen appliances',
  AIR_FRYER: 'Relevant small kitchen appliances',
  DEEP_FRYER: 'Relevant small kitchen appliances',
  WAFFLE_MAKER: 'Relevant small kitchen appliances',
  SANDWICH_MAKER: 'Relevant small kitchen appliances',
  ELECTRIC_GRILL: 'Relevant small kitchen appliances',
  IMMERSION_BLENDER: 'Relevant small kitchen appliances',
  JUICER: 'Relevant small kitchen appliances',
  COFFEE_MAKER: 'Relevant small kitchen appliances',
  ESPRESSO_MACHINE: 'Relevant small kitchen appliances',
  DISH_RACK: 'Kitchen organization',
  KITCHEN_ORGANIZER: 'Kitchen organization',
  SPICE_RACK: 'Kitchen organization',
  CANISTER: 'Food storage',
  LUNCH_BOX: 'Food storage',
  BENTO: 'Food storage',
}

/** Hard exclusions — name/display match alone must not classify these as Kitchen housewares. */
const EXCLUSION_PATTERNS = [
  /^TOY_/i,
  /DOLL_HOUSE|PLAY_KITCHEN|TOY_KITCHEN/i,
  /BLOOD_PRESSURE|PRESSURE_MONITOR|SPHYGMO/i,
  /LICENSE_PLATE|NUMBER_PLATE/i,
  /BRA_CUP|NURSING_CUP|MENSTRUAL_CUP|SANITARY_NAPKIN/i,
  /SURGICAL_KNIFE|HUNTING_KNIFE|COMBAT_KNIFE|POCKET_KNIFE/i,
  /FAUCET|KITCHEN_SINK|SINK_BASIN|PLUMB_|^SINK$/i,
  /CABINET_HARDWARE|KITCHEN_CABINET(?!_ORGAN)/i,
  /SOFTWARE|VIDEO_GAME|EBOOK|DOWNLOADABLE/i,
  /AUTOMOBILE|^AUTO_|CAR_|MOTORCYCLE|VEHICLE_/i,
  /PET_FOOD(?!_STORAGE)/i,
  /LIVESTOCK|AGRICULTURAL/i,
  /CAMPING_(?!COOK|KITCHEN)/i,
  /^KETTLEBELL$/i,
  /HVAC_|THERMOSTAT/i,
  /^BATTERY$/i,
  /^LIGHT_BULB$/i,
  /MECHANICAL_BELT|VACUUM_BELT/i,
  /CARPET_UPHOLSTERY|VACUUM_CLEANER|FLOOR_CARE/i,
  /^COCKTAIL_MIX$/i,
]

const NAME_SECTION_RULES = [
  { section: 'Cookware sets', re: /COOKWARE_SET|POT_AND_PAN_SET|POT_PAN_SET/i },
  { section: 'Frying, sauté and grill pans', re: /SAUTE|FRY_PAN|FRYING_PAN|GRILL_PAN|SKILLET|GRIDDLE_PAN/i },
  { section: 'Pressure cookers', re: /PRESSURE_COOKER|INSTANT_POT/i },
  { section: 'Kettles', re: /(^|_)(STOVETOP_)?KETTLE($|_)/i },
  { section: 'Kettles', re: /ELECTRIC_KETTLE|WATER_BOILER|TEA_KETTLE/i },
  { section: 'Bakeware', re: /BAKEWARE|BAKING_PAN|BAKING_SHEET|CAKE_PAN|MUFFIN_PAN|LOAF_PAN|PIE_PAN|ROASTING_TIN/i },
  { section: 'Baking tools and moulds', re: /BAKING_(CUP|MAT|MOLD|MOULD|TOOL)|PASTRY_|COOKIE_CUTTER|PIPING_BAG|ROLLING_PIN/i },
  { section: 'Knives and cutting accessories', re: /KITCHEN_KNIFE|KNIFE_SET|KNIFE_BLOCK|CUTTING_BOARD|CLEAVER|KITCHEN_SHEAR/i },
  { section: 'Kitchen utensils and gadgets', re: /KITCHEN_TOOL|KITCHEN_UTENSIL|GADGET|SPATULA|LADLE|WHISK|TONGS|PEELER|CAN_OPENER|GARLIC_PRESS|GRATER/i },
  { section: 'Food preparation', re: /FOOD_PREP|MANDOLINE|MORTAR_PESTLE|COLANDER|SALAD_SPINNER|MIXING_BOWL/i },
  { section: 'Food storage', re: /FOOD_STORAGE|LUNCH_BOX|BENTO|CANISTER|FOOD_JAR|PANTRY_CONTAINER/i },
  { section: 'Kitchen organization', re: /KITCHEN_ORGAN|DISH_RACK|SPICE_RACK|POT_RACK|UTENSIL_HOLDER|DRAWER_ORGANIZER_KITCHEN/i },
  { section: 'Dinnerware', re: /DINNERWARE|DISHWARE|PLACE_SETTING/i },
  { section: 'Serveware', re: /SERVEWARE|SERVING_(TRAY|BOWL|PLATTER|UTENSIL|DISH)/i },
  { section: 'Flatware and cutlery', re: /FLATWARE|CUTLERY|CHOPSTICK|TABLE_KNIFE|DINNER_FORK|DINNER_SPOON/i },
  { section: 'Drinkware', re: /DRINKWARE|DRINKING_CUP|DRINKING_GLASS|(^|_)MUG($|_)|TUMBLER|WINE_GLASS|STEMWARE|WATER_BOTTLE(?!_FILTER)/i },
  { section: 'Tea and coffee accessories', re: /TEA_POT|TEAPOT|COFFEE_POT|FRENCH_PRESS|COFFEE_FILTER|TEA_INFUSER|MILK_FROTHER|COFFEE_GRINDER/i },
  { section: 'Vacuum flasks and thermoses', re: /(^|_)THERMOS($|_)|VACUUM_FLASK|VACUUM_BOTTLE|INSULATED_BOTTLE/i },
  { section: 'Kitchen linen', re: /KITCHEN_TOWEL|OVEN_MITT|POT_HOLDER|(^|_)APRON($|_)|PLACE_MAT|TABLECLOTH|(^|_)NAPKIN($|_)|DISH_CLOTH/i },
  { section: 'Barware', re: /BARWARE|COCKTAIL_(SHAKER|SET|TOOL)|BAR_TOOL|WINE_OPENER|CORKSCREW|ICE_BUCKET/i },
  { section: 'Pots and pans', re: /COOKING_POT|SAUCEPAN|STOCKPOT|DUTCH_OVEN|ROASTING_PAN|WOK|CASSEROLE|STEAMER_POT|COOKWARE(?!_SET)/i },
  { section: 'Cookware', re: /^COOKWARE$|COOKWARE_/i },
  {
    section: 'Relevant small kitchen appliances',
    re: /AIR_FRYER|RICE_COOKER|SLOW_COOKER|FOOD_PROCESSOR|BLENDER|STAND_MIXER|HAND_MIXER|TOASTER|MICROWAVE|WAFFLE|SANDWICH_MAKER|DEEP_FRYER|JUICER|ESPRESSO|COFFEE_MAKER|IMMERSION_BLENDER|ELECTRIC_GRILL|BREAD_MAKER|SOUS_VIDE|ELECTRIC_PRESSURE|KITCHEN_SCALE|ELECTRIC_KNIFE/i,
  },
]

const BROWSE_SECTION_RULES = [
  { section: 'Cookware sets', re: /Cookware.*>.*Sets|Pot & Pan Sets|Pan Sets|Pot Sets/i },
  { section: 'Frying, sauté and grill pans', re: /Fry(?:ing)? Pans|Saute|Sauté|Grill Pans|Skillets/i },
  { section: 'Pressure cookers', re: /Pressure Cookers/i },
  { section: 'Kettles', re: /\bKettles\b|Tea Kettles|Electric Kettles/i },
  { section: 'Bakeware', re: /\bBakeware\b|Baking Dishes|Cake Pans|Baking Sheets/i },
  { section: 'Baking tools and moulds', re: /Baking Tools|Baking Mats|Cookie Cutters|Pastry/i },
  { section: 'Knives and cutting accessories', re: /Kitchen Knives|Cutlery.*Knives|Cutting Boards|Knife Blocks/i },
  { section: 'Kitchen utensils and gadgets', re: /Kitchen Utensils|Cooking Utensils|Kitchen Gadgets|Tools & Gadgets/i },
  { section: 'Food preparation', re: /Food Preparation|Prep Tools|Colanders|Mixing Bowls/i },
  { section: 'Food storage', re: /Food Storage|Storage Containers|Lunch Boxes|Containers & Storage > Food/i },
  { section: 'Kitchen organization', re: /Kitchen Storage|Kitchen Organization|Dish Racks|Spice Racks|Racks & Holders|Cabinet & Drawer Organizers/i },
  { section: 'Dinnerware', re: /Dinnerware|Tableware > Plates|Tableware > Bowls/i },
  { section: 'Serveware', re: /Serveware|Serving Dishes|Serving Trays|Platters/i },
  { section: 'Flatware and cutlery', re: /Flatware|Cutlery Sets|Forks|Spoons/i },
  { section: 'Drinkware', re: /Drinkware|Tumblers|Mugs|Glasses|Wine Glasses|Tableware > Cups/i },
  { section: 'Tea and coffee accessories', re: /Tea Accessories|Coffee Accessories|Teapots|French Presses|Coffee, Tea & Espresso/i },
  { section: 'Vacuum flasks and thermoses', re: /Thermoses|Vacuum Flasks|Insulated Bottles/i },
  { section: 'Kitchen linen', re: /Kitchen Linen|Kitchen Towels|Oven Mitts|Aprons|Table Linen|Comfort Mats/i },
  { section: 'Barware', re: /Bar Tools|Barware|Cocktail/i },
  { section: 'Pots and pans', re: /Pots & Pans|Sauce Pans|Stock Pots|Dutch Ovens|Woks|Roasting Pans/i },
  { section: 'Cookware', re: /^Kitchen > Cookware|Cookware >/i },
  { section: 'Relevant small kitchen appliances', re: /Small Appliances|Kitchen Appliances|Coffee Machines|Blenders|Food Processors|Toasters|Microwaves|Air Fryers|Rice Cookers|Slow Cookers|Fryers/i },
]

/**
 * @param {string} label
 */
function isHomeKitchenBrowsePath(label) {
  const s = String(label || '')
  if (!s) return false

  // Mid-path "Kitchen" under Automotive/RV/etc. is not the Kitchen storefront.
  if (/^(Automotive|Sporting Goods|Toys|Baby|Industrial|Electronics|Fashion|Office Products|Tools & Home Improvement|Health|Grocery)\b/i.test(s)) {
    return false
  }

  // Amazon UAE nests vacuums under Kitchen, but that is not Kitchen & Dining housewares.
  if (/Kitchen > Vacuums, Window & Floor Care/i.test(s)) {
    return false
  }

  return (
    /^Kitchen >/i.test(s) ||
    /^Home & Kitchen\b/i.test(s) ||
    /^Kitchen & Dining\b/i.test(s) ||
    /^Appliances > Small Appliances\b/i.test(s)
  )
}

/**
 * @param {string[]} labels
 * @param {{ minKitchenShare?: number }} [opts]
 */
function pickSectionFromBrowseLabels(labels, opts = {}) {
  const allLabels = labels || []
  const kitchenLabels = allLabels.filter(isHomeKitchenBrowsePath)
  if (!kitchenLabels.length) return { section: '', kitchenLabels: [], kitchenShare: 0 }
  const kitchenShare = kitchenLabels.length / Math.max(1, allLabels.length)
  const minShare = opts.minKitchenShare != null ? opts.minKitchenShare : 0
  if (kitchenShare < minShare) {
    return { section: '', kitchenLabels: [], kitchenShare }
  }
  for (const rule of BROWSE_SECTION_RULES) {
    if (kitchenLabels.some((l) => rule.re.test(l))) {
      return { section: rule.section, kitchenLabels, kitchenShare }
    }
  }
  return { section: 'Kitchen (browse-node matched)', kitchenLabels, kitchenShare }
}

/**
 * @param {string} name
 * @param {string} displayName
 */
function isExcluded(name, displayName) {
  const hay = `${name} ${displayName}`
  return EXCLUSION_PATTERNS.some((re) => re.test(name) || re.test(displayName) || re.test(hay))
}

/**
 * @param {string} name
 * @param {string} displayName
 */
function sectionFromName(name, displayName) {
  const exact = EXACT_TYPE_SECTIONS[String(name || '').toUpperCase()]
  if (exact) return { section: exact, exact: true }
  const hay = `${name} ${displayName}`
  for (const rule of NAME_SECTION_RULES) {
    if (rule.re.test(name) || rule.re.test(displayName) || rule.re.test(hay)) {
      return { section: rule.section, exact: false }
    }
  }
  return { section: '', exact: false }
}

/**
 * @param {object} input
 * @param {string} input.name
 * @param {string} [input.displayName]
 * @param {string[]} [input.browseNodeLabels]
 * @param {string[]} [input.itemTypeKeywords]
 * @param {string[]} [input.propertyGroups]
 * @returns {Classification}
 */
function classifyKitchenProductType(input) {
  const name = String(input && input.name != null ? input.name : '').trim()
  const displayName = String(input && input.displayName != null ? input.displayName : '').trim()
  const browseNodeLabels = Array.isArray(input && input.browseNodeLabels) ? input.browseNodeLabels : []
  const itemTypeKeywords = Array.isArray(input && input.itemTypeKeywords) ? input.itemTypeKeywords : []

  if (!name) {
    return {
      is_kitchen: false,
      kitchen_section: '',
      confidence: '',
      classification_source: 'none',
      classification_reason: 'Missing product type name',
    }
  }

  if (isExcluded(name, displayName)) {
    return {
      is_kitchen: false,
      kitchen_section: '',
      confidence: 'exact',
      classification_source: 'exclusion_rules',
      classification_reason: 'Excluded as non-housewares / false-positive pattern (toys, plumbing, medical, automotive, etc.)',
    }
  }

  const nameHit = sectionFromName(name, displayName)
  // Secondary Kitchen browse nodes on generic furniture/cleaning product types are not enough.
  const requiresStrongBrowseShare = !nameHit.section
  const browse = pickSectionFromBrowseLabels(browseNodeLabels, {
    minKitchenShare: requiresStrongBrowseShare ? 0.15 : 0,
  })
  if (browse.kitchenLabels.length) {
    const section = nameHit.section || browse.section || 'Kitchen (browse-node matched)'
    const applianceOnly = browse.kitchenLabels.every((l) => /^Appliances > Small Appliances\b/i.test(l))
    return {
      is_kitchen: true,
      kitchen_section: section,
      confidence: 'exact',
      classification_source: applianceOnly
        ? 'schema_recommended_browse_nodes_small_appliances'
        : 'schema_recommended_browse_nodes',
      classification_reason: applianceOnly
        ? `Official recommended browse-node label(s) under Appliances > Small Appliances: ${browse.kitchenLabels.slice(0, 3).join('; ')}`
        : `Official recommended browse-node label(s) under Kitchen: ${browse.kitchenLabels.slice(0, 3).join('; ')}`,
    }
  }

  if (nameHit.section && nameHit.exact) {
    return {
      is_kitchen: true,
      kitchen_section: nameHit.section,
      confidence: 'high',
      classification_source: 'product_type_code',
      classification_reason: `Product type code ${name} maps to a known Kitchen housewares type (not an official Amazon category-tree membership field)`,
    }
  }

  if (nameHit.section) {
    return {
      is_kitchen: true,
      kitchen_section: nameHit.section,
      confidence: 'medium',
      classification_source: 'product_type_name_and_display_name',
      classification_reason: `Inferred from product type code/display name pattern for section "${nameHit.section}" (not an official Amazon Kitchen hierarchy mapping)`,
    }
  }

  const keywordHay = itemTypeKeywords.join(' | ')
  if (/kitchen|cookware|bakeware|dinnerware|drinkware|cutlery|cook(ing)?/i.test(keywordHay)) {
    return {
      is_kitchen: true,
      kitchen_section: 'Kitchen (item-type keyword)',
      confidence: 'medium',
      classification_source: 'schema_item_type_keyword',
      classification_reason: `item_type_keyword values suggest kitchen housewares: ${itemTypeKeywords.slice(0, 5).join(', ')}`,
    }
  }

  // Weak display-name kitchen word alone is not enough (avoids false positives).
  if (/\bkitchen\b/i.test(displayName) && /utensil|tool|gadget|ware|cook|bake|dining/i.test(`${name} ${displayName}`)) {
    return {
      is_kitchen: true,
      kitchen_section: 'Kitchen utensils and gadgets',
      confidence: 'low',
      classification_source: 'display_name',
      classification_reason: 'Low-confidence inference from display name wording only; no Kitchen browse-node evidence in schema',
    }
  }

  return {
    is_kitchen: false,
    kitchen_section: '',
    confidence: '',
    classification_source: 'none',
    classification_reason:
      browseNodeLabels.length > 0
        ? 'Schema browse nodes present but none under Home/Kitchen housewares paths'
        : 'No Kitchen browse-node evidence and no matching housewares name pattern',
  }
}

module.exports = {
  EXACT_TYPE_SECTIONS,
  isHomeKitchenBrowsePath,
  classifyKitchenProductType,
  pickSectionFromBrowseLabels,
  sectionFromName,
  isExcluded,
}
