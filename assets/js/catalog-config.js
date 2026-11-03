// Shared by the storefront (index.html) and the admin (admin/index.html).
// Categories, product types and the Facebook Marketplace category each maps to.
window.FAV_CONFIG = (function () {
  // 24x24 line icons, drawn with stroke="currentColor".
  const ICONS = {
    sofa: "M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2zM5 18v2M19 18v2",
    bed: "M2 19V5M2 15h20M22 19v-6a3 3 0 0 0-3-3h-8v5M6.5 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    dining: "M3 9h18M6 9v11M18 9v11M9 4h6M12 4v5M3 14h3M18 14h3",
    office: "M2 8h20M4 8v12M20 8v12M13 8v6h7M13 11h7M7 3h5v5H7z",
    school: "M3 10h11M5 10v9M12 10v9M17 5v14M17 13h4v6M3 6h11",
    wardrobe: "M5 3h14v18H5zM12 3v18M10 11v2M14 11v2M5 18h14",
    table: "M3 9h18M6 9v10M18 9v10M6 14h12",
    tv: "M3 12h18v8H3zM12 12v8M3 16h18M7 3h10v6H7z",
    chair: "M7 3h10v9H7zM5 12h14M7 12v9M17 12v9",
    bookshelf: "M5 3h14v18H5zM5 9h14M5 15h14M8 5v4M10 5v4M14 11v4",
    nightstand: "M5 5h14v14H5zM5 12h14M11 8.5h2M11 15.5h2M7 19v2M17 19v2",
    mirror: "M12 2a5 7 0 1 0 0 14 5 7 0 1 0 0-14zM12 16v5M8 21h8",
    wallpaper: "M4 3h16v18H4zM4 9h16M4 15h16M10 3v6M14 9v6M10 15v6",
    toilet: "M6 3h7v6H6zM4 9h15a6 6 0 0 1-6 6H9a5 5 0 0 1-5-5zM9 15l-1 6h8l-1-6",
    electronics: "M3 4h18v12H3zM8 20h8M12 16v4",
    paper: "M6 2h9l4 4v16H6zM15 2v4h4M9 11h7M9 15h7M9 19h4",
    grocery: "M6 7h12l-1 14H7zM9 7V5a3 3 0 0 1 6 0v2",
    custom: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"
  };

  const CATEGORIES = [
    { id: "Living Room", icon: "sofa", types: ["Sofa", "Sectional Sofa", "Armchair", "Centre Table", "TV Stand", "Shoe Rack", "Side Table"] },
    { id: "Bedroom", icon: "bed", types: ["Bed Frame", "Wardrobe", "Bedside Table", "Dressing Mirror", "Chest of Drawers", "Mattress"] },
    { id: "Dining", icon: "dining", types: ["Dining Set", "Dining Table", "Dining Chairs", "Kitchen Cabinet", "Bar Stool"] },
    { id: "Office", icon: "office", types: ["Office Desk", "Office Chair", "Conference Chair", "Bookshelf", "Conference Table", "Filing Cabinet", "Reception Desk"] },
    { id: "School", icon: "school", types: ["Classroom Desk", "Student Chair", "Teacher's Table", "Library Shelf", "Bunk Bed"] },
    { id: "Walls & Decor", icon: "wallpaper", types: ["Wallpaper", "Wall Panel"] },
    { id: "Bathroom & Tiles", icon: "toilet", types: ["Water Closet", "Tiles", "Plumbing", "Bathroom Mirror"] },
    { id: "Electronics", icon: "electronics", types: ["Television", "Air Conditioner", "Appliance"] },
    { id: "Printing & Stationery", icon: "paper", types: ["Business Cards", "Copy Paper", "Printing", "Stationery"] },
    { id: "Groceries", icon: "grocery", types: ["Flour", "Rice", "Cooking Oil", "Food Item"] },
    { id: "Custom", icon: "custom", types: ["Custom Build", "Re-upholstery", "Repairs", "Other"] }
  ];

  // Facebook Marketplace "Home & Garden > Furniture > …" sub-category per type.
  const MARKETPLACE = {
    "Sofa": "Sofas", "Sectional Sofa": "Sofas", "Armchair": "Chairs", "Centre Table": "Tables",
    "TV Stand": "TV Stands", "Shoe Rack": "Storage", "Side Table": "Tables",
    "Bed Frame": "Beds & Bed Frames", "Wardrobe": "Wardrobes", "Bedside Table": "Nightstands",
    "Dressing Mirror": "Mirrors", "Chest of Drawers": "Dressers", "Mattress": "Mattresses",
    "Dining Set": "Dining Sets", "Dining Table": "Tables", "Dining Chairs": "Chairs",
    "Kitchen Cabinet": "Cabinets", "Bar Stool": "Chairs",
    "Office Desk": "Desks", "Office Chair": "Chairs", "Conference Chair": "Chairs", "Bookshelf": "Bookcases",
    "Conference Table": "Tables", "Filing Cabinet": "Cabinets", "Reception Desk": "Desks",
    "Classroom Desk": "Desks", "Student Chair": "Chairs", "Teacher's Table": "Desks",
    "Library Shelf": "Bookcases", "Bunk Bed": "Beds & Bed Frames"
  };

  const COLOURS = ["Natural Wood", "Dark Brown", "Mahogany", "Black", "White", "Grey", "Cream", "Beige", "Blue", "Green", "Red", "Gold"];
  const CONDITIONS = ["Brand New", "Used", "Refurbished"];

  // Product types that read better with their own icon than their category's.
  const TYPE_ICONS = {
    "Armchair": "chair", "Centre Table": "table", "Side Table": "table", "TV Stand": "tv", "Shoe Rack": "bookshelf",
    "Wardrobe": "wardrobe", "Bedside Table": "nightstand", "Dressing Mirror": "mirror", "Chest of Drawers": "nightstand",
    "Dining Table": "table", "Dining Chairs": "chair", "Kitchen Cabinet": "wardrobe", "Bar Stool": "chair",
    "Office Chair": "chair", "Conference Chair": "chair", "Bookshelf": "bookshelf", "Conference Table": "table", "Filing Cabinet": "nightstand",
    "Student Chair": "chair", "Library Shelf": "bookshelf", "Bunk Bed": "bed"
  };

  // Accepts a product ({category, type}) or a bare category name.
  function categoryIcon(product) {
    const p = typeof product === "string" ? { category: product } : product;
    const c = CATEGORIES.find(c => c.id === p.category);
    return ICONS[TYPE_ICONS[p.type] || (c && c.icon) || "wardrobe"];
  }

  function iconSvg(path, size) {
    return `<svg viewBox="0 0 24 24" width="${size || 24}" height="${size || 24}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  }

  function marketplaceCategory(type) {
    if (type === "Wallpaper" || type === "Wall Panel") return "Home & Garden > Home Decor > Wallpaper";
    const OTHER = {
      "Water Closet": "Home Improvement Supplies > Plumbing", "Tiles": "Home Improvement Supplies > Flooring",
      "Plumbing": "Home Improvement Supplies > Plumbing", "Bathroom Mirror": "Home & Garden > Bath",
      "Television": "Electronics > TVs", "Air Conditioner": "Home & Garden > Appliances", "Appliance": "Home & Garden > Appliances",
      "Business Cards": "Office Supplies", "Copy Paper": "Office Supplies", "Printing": "Office Supplies", "Stationery": "Office Supplies",
      "Flour": "Groceries", "Rice": "Groceries", "Cooking Oil": "Groceries", "Food Item": "Groceries"
    };
    if (OTHER[type]) return OTHER[type];
    return "Home & Garden > Furniture > " + (MARKETPLACE[type] || "Other Furniture");
  }

  function formatPrice(n) {
    return "GH₵ " + Number(n).toLocaleString("en-GH");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // "+233207473267" -> "020 747 3267"
  function localPhone(number) {
    let d = String(number).replace(/\D/g, "");
    if (d.startsWith("233")) d = "0" + d.slice(3);
    return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  }

  return { ICONS, CATEGORIES, COLOURS, CONDITIONS, categoryIcon, iconSvg, marketplaceCategory, formatPrice, escapeHtml, localPhone };
})();
