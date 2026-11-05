import asyncio
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import CatalogBrand, CatalogCategory, Product, Shop
from app.core.config import Settings, get_settings
from app.db.session import get_engine, get_session_factory
from app.identity.models import CustomerProfile, User, UserRole, VendorApplication
from app.identity.security import hash_password, verify_password

DEMO_PASSWORD = "VendorDemo2026!"


@dataclass(frozen=True)
class VendorSeed:
    business_name: str
    shop_name: str
    city: str
    province: str
    latitude: Decimal
    longitude: Decimal
    business_type: str


@dataclass(frozen=True)
class ProductSeed:
    name: str
    category: str
    brand: str
    price: str
    stock: int
    description: str


VENDORS = (
    VendorSeed(
        "Kathmandu Craft House",
        "Kathmandu Craft House",
        "Kathmandu",
        "Bagmati",
        Decimal("27.7172"),
        Decimal("85.3240"),
        "Handicrafts",
    ),
    VendorSeed(
        "Pokhara Pantry",
        "Pokhara Pantry",
        "Pokhara",
        "Gandaki",
        Decimal("28.2096"),
        Decimal("83.9856"),
        "Food and Grocery",
    ),
    VendorSeed(
        "Lalitpur Looms",
        "Lalitpur Looms",
        "Lalitpur",
        "Bagmati",
        Decimal("27.6588"),
        Decimal("85.3247"),
        "Textiles",
    ),
    VendorSeed(
        "Terai Harvest Co.",
        "Terai Harvest Co.",
        "Biratnagar",
        "Koshi",
        Decimal("26.4525"),
        Decimal("87.2718"),
        "Food and Grocery",
    ),
    VendorSeed(
        "Himalayan Home",
        "Himalayan Home",
        "Bharatpur",
        "Bagmati",
        Decimal("27.6766"),
        Decimal("84.4359"),
        "Home Goods",
    ),
    VendorSeed(
        "Bhaktapur Pottery Works",
        "Bhaktapur Pottery Works",
        "Bhaktapur",
        "Bagmati",
        Decimal("27.6710"),
        Decimal("85.4298"),
        "Pottery",
    ),
    VendorSeed(
        "Butwal Botanicals",
        "Butwal Botanicals",
        "Butwal",
        "Lumbini",
        Decimal("27.7006"),
        Decimal("83.4484"),
        "Personal Care",
    ),
    VendorSeed(
        "Dharan Outdoor Supply",
        "Dharan Outdoor Supply",
        "Dharan",
        "Koshi",
        Decimal("26.8065"),
        Decimal("87.2846"),
        "Outdoor Goods",
    ),
    VendorSeed(
        "Janakpur Kitchen",
        "Janakpur Kitchen",
        "Janakpur",
        "Madhesh",
        Decimal("26.7271"),
        Decimal("85.9407"),
        "Kitchen Goods",
    ),
    VendorSeed(
        "Nepal Made Studio",
        "Nepal Made Studio",
        "Nepalgunj",
        "Lumbini",
        Decimal("28.0500"),
        Decimal("81.6167"),
        "Handicrafts",
    ),
)

PRODUCTS = (
    ProductSeed(
        "Handwoven Bamboo Basket",
        "Home & Living",
        "Nepal Made",
        "850.00",
        24,
        "A durable, handwoven bamboo basket made by local artisans.",
    ),
    ProductSeed(
        "Carved Lokta Notebook",
        "Books & Stationery",
        "Kathmandu Craft",
        "420.00",
        40,
        "Hand-bound lokta paper notebook with a traditional cover.",
    ),
    ProductSeed(
        "Himalayan Buckwheat Flour",
        "Food & Grocery",
        "Himalayan Harvest",
        "380.00",
        32,
        "Stone-ground buckwheat flour sourced from Himalayan farms.",
    ),
    ProductSeed(
        "Organic Gundruk Pack",
        "Food & Grocery",
        "Terai Naturals",
        "260.00",
        50,
        "Traditional fermented leafy greens, dried and packed for home cooking.",
    ),
    ProductSeed(
        "Dhaka Cotton Scarf",
        "Fashion & Apparel",
        "Nepal Made",
        "1450.00",
        16,
        "Soft cotton scarf featuring a locally woven Dhaka pattern.",
    ),
    ProductSeed(
        "Handloom Cushion Cover",
        "Home & Living",
        "Kathmandu Craft",
        "1100.00",
        20,
        "Colorful handloom cushion cover with a concealed zipper.",
    ),
    ProductSeed(
        "Roasted Coffee Beans",
        "Food & Grocery",
        "Himalayan Harvest",
        "950.00",
        28,
        "Medium-roast Arabica beans grown and roasted in Nepal.",
    ),
    ProductSeed(
        "Timur Pepper Jar",
        "Food & Grocery",
        "Terai Naturals",
        "310.00",
        36,
        "Aromatic whole Timur pepper harvested in the Himalayan foothills.",
    ),
    ProductSeed(
        "Hand-thrown Tea Cup",
        "Home & Living",
        "Everest Essentials",
        "680.00",
        18,
        "Glazed stoneware tea cup shaped and finished by hand.",
    ),
    ProductSeed(
        "Brass Butter Lamp",
        "Home & Living",
        "Nepal Made",
        "1250.00",
        12,
        "Small polished brass butter lamp, cast by a local workshop.",
    ),
    ProductSeed(
        "Wild Honey Jar",
        "Food & Grocery",
        "Himalayan Harvest",
        "720.00",
        22,
        "Raw wildflower honey collected in the mid-hills.",
    ),
    ProductSeed(
        "Dried Apple Rings",
        "Food & Grocery",
        "Terai Naturals",
        "540.00",
        30,
        "Naturally dried apple rings with no added sugar.",
    ),
    ProductSeed(
        "Felted Wool Slippers",
        "Fashion & Apparel",
        "Nepal Made",
        "1850.00",
        14,
        "Warm wool slippers made from locally sourced felt.",
    ),
    ProductSeed(
        "Recycled Cotton Tote",
        "Fashion & Apparel",
        "Kathmandu Craft",
        "780.00",
        26,
        "Reusable tote bag sewn from sturdy recycled cotton.",
    ),
    ProductSeed(
        "Neem and Aloe Soap",
        "Beauty & Personal Care",
        "Everest Essentials",
        "240.00",
        45,
        "Gentle small-batch soap with neem and aloe vera.",
    ),
    ProductSeed(
        "Lemongrass Body Balm",
        "Beauty & Personal Care",
        "Terai Naturals",
        "590.00",
        19,
        "Moisturizing balm infused with locally grown lemongrass.",
    ),
    ProductSeed(
        "Insulated Trail Bottle",
        "Sports & Outdoors",
        "Everest Essentials",
        "1650.00",
        17,
        "Reusable stainless-steel bottle for everyday use and day hikes.",
    ),
    ProductSeed(
        "Compact First Aid Pouch",
        "Sports & Outdoors",
        "Himalayan Harvest",
        "990.00",
        21,
        "Lightweight zip pouch for organizing basic travel essentials.",
    ),
    ProductSeed(
        "Acacia Wood Serving Board",
        "Home & Living",
        "Kathmandu Craft",
        "1350.00",
        11,
        "Smooth-finished serving board made from responsibly sourced wood.",
    ),
    ProductSeed(
        "Copper Water Tumbler",
        "Home & Living",
        "Nepal Made",
        "1150.00",
        15,
        "Hand-finished copper tumbler for serving water.",
    ),
)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")


def _ensure_local_development(settings: Settings) -> None:
    database = urlsplit(settings.database_url)
    if settings.environment != "development" or database.hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        raise RuntimeError(
            "Demo data can only be seeded when VMARKET_ENVIRONMENT=development "
            "and the database host is localhost."
        )


async def seed_demo_data(session: AsyncSession) -> None:
    categories: dict[str, CatalogCategory] = {}
    category_names = dict.fromkeys(item.category for item in PRODUCTS)
    for name in category_names:
        slug = _slug(name)
        category = await session.scalar(select(CatalogCategory).where(CatalogCategory.slug == slug))
        if category is None:
            category = CatalogCategory(name=name, slug=slug)
            session.add(category)
            await session.flush()
        elif not category.is_active:
            raise RuntimeError(f"Cannot seed products into inactive category {name}.")
        categories[name] = category

    brands: dict[str, CatalogBrand] = {}
    brand_names = dict.fromkeys(item.brand for item in PRODUCTS)
    for name in brand_names:
        slug = _slug(name)
        brand = await session.scalar(select(CatalogBrand).where(CatalogBrand.slug == slug))
        if brand is None:
            brand = CatalogBrand(name=name, slug=slug)
            session.add(brand)
            await session.flush()
        brands[name] = brand

    shops: list[Shop] = []
    for index, vendor_seed in enumerate(VENDORS, start=1):
        email = f"demo.vendor{index:02}@example.com"
        shop_slug = f"demo-{_slug(vendor_seed.shop_name)}"
        user = await session.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                password_hash=hash_password(DEMO_PASSWORD),
                email_verified=True,
                account_status="active",
            )
            user.profile = CustomerProfile(full_name=vendor_seed.business_name)
            session.add(user)
            await session.flush()
        elif not verify_password(DEMO_PASSWORD, user.password_hash):
            raise RuntimeError(f"Refusing to overwrite credentials for existing account {email}.")

        shop = await session.scalar(select(Shop).where(Shop.slug == shop_slug))
        if shop is None:
            if await session.scalar(select(Shop.id).where(Shop.owner_user_id == user.id)):
                raise RuntimeError(f"Account {email} already owns a non-demo shop.")
            shop = Shop(
                owner_user_id=user.id,
                name=vendor_seed.shop_name,
                slug=shop_slug,
                description=(
                    f"Local {vendor_seed.business_type.lower()} shop serving {vendor_seed.city}."
                ),
                address=f"{vendor_seed.city}, Nepal",
                city=vendor_seed.city,
                province=vendor_seed.province,
                latitude=vendor_seed.latitude,
                longitude=vendor_seed.longitude,
            )
            session.add(shop)
            await session.flush()
        elif shop.owner_user_id != user.id:
            raise RuntimeError(f"Demo shop slug {shop_slug} is owned by another account.")
        shops.append(shop)

        if await session.get(UserRole, (user.id, "customer")) is None:
            session.add(UserRole(user_id=user.id, role="customer"))
        if await session.get(UserRole, (user.id, "vendor")) is None:
            session.add(UserRole(user_id=user.id, role="vendor"))
        application = await session.scalar(
            select(VendorApplication).where(VendorApplication.user_id == user.id)
        )
        if application is None:
            session.add(
                VendorApplication(
                    user_id=user.id,
                    business_name=vendor_seed.business_name,
                    business_type=vendor_seed.business_type,
                    business_address=f"{vendor_seed.city}, {vendor_seed.province}, Nepal",
                    status="approved",
                    reviewed_at=datetime.now(timezone.utc),
                )
            )
        elif application.status != "approved":
            raise RuntimeError(f"Demo vendor account {email} has no approved application.")

    for index, product_seed in enumerate(PRODUCTS):
        vendor_index = index // 2
        sku = f"DEMO-{vendor_index + 1:02}-{index % 2 + 1:02}"
        slug = f"demo-{_slug(product_seed.name)}-{vendor_index + 1:02}"
        product = await session.scalar(select(Product).where(Product.slug == slug))
        if product is None:
            product = Product(
                shop_id=shops[vendor_index].id,
                category_id=categories[product_seed.category].id,
                brand_id=brands[product_seed.brand].id,
                name=product_seed.name,
                slug=slug,
                description=product_seed.description,
                sku=sku,
                price=Decimal(product_seed.price),
                stock=product_seed.stock,
                attributes={"origin": "Nepal"},
                status="approved",
            )
            session.add(product)
        elif product.shop_id != shops[vendor_index].id:
            raise RuntimeError(f"Demo product slug {slug} is owned by another shop.")


async def _seed() -> None:
    settings = get_settings()
    _ensure_local_development(settings)
    try:
        async with get_session_factory()() as session, session.begin():
            await seed_demo_data(session)
        print("Seeded 10 demo vendor accounts and 20 approved demo products.")
        print(f"Password for all demo vendors: {DEMO_PASSWORD}")
        for index in range(1, len(VENDORS) + 1):
            print(f"  demo.vendor{index:02}@example.com")
    finally:
        await get_engine().dispose()


def main() -> None:
    asyncio.run(_seed())


if __name__ == "__main__":
    main()
