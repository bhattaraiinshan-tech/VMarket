import logging
import math
import re
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from minio.error import S3Error
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import (
    CatalogBrand,
    CatalogCategory,
    CategoryAttribute,
    Product,
    ProductImage,
    ProductVariant,
    Shop,
    WishlistItem,
)
from app.catalog.schemas import (
    BrandCreate,
    BrandRead,
    CategoryAttributeCreate,
    CategoryAttributeRead,
    CategoryCreate,
    CategoryRead,
    ProductCreate,
    ProductImageRead,
    ProductModerationDecision,
    ProductPage,
    ProductRead,
    ProductUpdate,
    ProductVariantCreate,
    ProductVariantRead,
    ProductVariantUpdate,
    ShopCreate,
    ShopRead,
    ShopUpdate,
)
from app.catalog.urls import public_object_url
from app.core.config import get_settings
from app.core.errors import APIError
from app.db.session import get_session
from app.identity.dependencies import (
    get_active_shop,
    get_current_admin,
    get_current_customer,
    get_current_vendor,
    get_selected_shop,
)
from app.identity.models import AuditLog, User, VendorProfile
from app.storage.client import get_minio_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["catalog"])
MAX_IMAGE_SIZE = 8 * 1024 * 1024
IMAGE_TYPES = {
    "image/jpeg": ("jpg", b"\xff\xd8\xff"),
    "image/png": ("png", b"\x89PNG\r\n\x1a\n"),
    "image/webp": ("webp", b"RIFF"),
}


def _slug(name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")
    return f"{normalized[:120] or 'item'}-{uuid4().hex[:8]}"


_public_url = public_object_url


def _shop_read(shop: Shop, distance_km: float | None = None) -> ShopRead:
    logo_url = _public_url(shop.logo_object_name) if shop.logo_object_name else None
    return ShopRead(
        id=shop.id,
        slot=shop.slot,
        is_active=shop.is_active,
        name=shop.name,
        slug=shop.slug,
        description=shop.description,
        address=shop.address,
        city=shop.city,
        province=shop.province,
        latitude=shop.latitude,
        longitude=shop.longitude,
        logo_url=logo_url,
        distance_km=distance_km,
        created_at=shop.created_at,
    )


async def _product_reads(session: AsyncSession, products: list[Product]) -> list[ProductRead]:
    if not products:
        return []

    product_ids = [product.id for product in products]
    shops = {
        shop.id: shop
        for shop in await session.scalars(
            select(Shop).where(Shop.id.in_({product.shop_id for product in products}))
        )
    }
    categories = {
        category.id: category
        for category in await session.scalars(
            select(CatalogCategory).where(
                CatalogCategory.id.in_({product.category_id for product in products})
            )
        )
    }
    brand_ids = {product.brand_id for product in products if product.brand_id is not None}
    brands = (
        {
            brand.id: brand
            for brand in await session.scalars(
                select(CatalogBrand).where(CatalogBrand.id.in_(brand_ids))
            )
        }
        if brand_ids
        else {}
    )
    images: dict[UUID, list[ProductImage]] = {}
    for image in await session.scalars(
        select(ProductImage)
        .where(ProductImage.product_id.in_(product_ids))
        .order_by(ProductImage.sort_order, ProductImage.created_at)
    ):
        images.setdefault(image.product_id, []).append(image)
    variants: dict[UUID, list[ProductVariant]] = {}
    for variant in await session.scalars(
        select(ProductVariant)
        .where(ProductVariant.product_id.in_(product_ids))
        .order_by(ProductVariant.created_at)
    ):
        variants.setdefault(variant.product_id, []).append(variant)

    result: list[ProductRead] = []
    for product in products:
        shop = shops[product.shop_id]
        category = categories[product.category_id]
        brand = brands.get(product.brand_id) if product.brand_id is not None else None
        product_variants = variants.get(product.id, [])
        product_images = images.get(product.id, [])
        result.append(
            ProductRead(
                id=product.id,
                shop_id=shop.id,
                shop_name=shop.name,
                shop_slug=shop.slug,
                category_id=category.id,
                category_name=category.name,
                brand_id=brand.id if brand else None,
                brand_name=brand.name if brand else None,
                name=product.name,
                slug=product.slug,
                description=product.description,
                sku=product.sku,
                price=product.price,
                stock=product.stock,
                available=(
                    any(item.stock > 0 for item in product_variants)
                    if product_variants
                    else product.stock > 0
                ),
                attributes=product.attributes,
                status=product.status,
                moderation_notes=product.moderation_notes,
                images=[
                    ProductImageRead(
                        id=image.id,
                        url=_public_url(image.object_name),
                        alt_text=image.alt_text,
                        sort_order=image.sort_order,
                    )
                    for image in product_images
                ],
                variants=[ProductVariantRead.model_validate(item) for item in product_variants],
                created_at=product.created_at,
            )
        )
    return result


async def _owned_product(
    session: AsyncSession,
    shop: Shop,
    product_id: UUID,
) -> Product:
    product = await session.scalar(
        select(Product).where(Product.id == product_id, Product.shop_id == shop.id)
    )
    if product is None:
        raise APIError(404, "product_not_found", "Product was not found.")
    return product


async def _validate_category_attributes(
    session: AsyncSession,
    category_id: UUID,
    values: dict[str, str],
    *,
    variant: bool = False,
) -> None:
    definitions = list(
        await session.scalars(
            select(CategoryAttribute).where(CategoryAttribute.category_id == category_id)
        )
    )
    allowed = {item.key: item for item in definitions if item.applies_to_variant == variant}
    unknown = set(values) - allowed.keys()
    if unknown:
        raise APIError(
            422,
            "unknown_product_attributes",
            "The listing contains attributes not defined for its category.",
            sorted(unknown),
        )
    missing = [item.key for item in allowed.values() if item.required and item.key not in values]
    if missing:
        raise APIError(
            422,
            "required_product_attributes_missing",
            "Required category attributes are missing.",
            missing,
        )
    for key, value in values.items():
        definition = allowed[key]
        if definition.value_type == "number":
            try:
                number = Decimal(value)
            except (InvalidOperation, ValueError):
                raise APIError(
                    422,
                    "invalid_product_attribute",
                    f"Attribute '{key}' must be a number.",
                ) from None
            if not number.is_finite():
                raise APIError(
                    422,
                    "invalid_product_attribute",
                    f"Attribute '{key}' must be a finite number.",
                )
        elif definition.value_type == "boolean" and value.casefold() not in {
            "true",
            "false",
        }:
            raise APIError(
                422,
                "invalid_product_attribute",
                f"Attribute '{key}' must be true or false.",
            )


def _audit(
    session: AsyncSession,
    admin: User,
    action: str,
    target_type: str,
    target_id: UUID,
    details: str | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_id=admin.id,
            action=action,
            target_type=target_type,
            target_id=str(target_id),
            details=details,
        )
    )


@router.get("/catalog/categories", response_model=list[CategoryRead])
async def list_categories(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[CategoryRead]:
    categories = await session.scalars(
        select(CatalogCategory)
        .where(CatalogCategory.is_active.is_(True))
        .order_by(CatalogCategory.name)
    )
    category_list = list(categories)
    definitions: list[CategoryAttribute] = (
        list(
            await session.scalars(
                select(CategoryAttribute)
                .where(CategoryAttribute.category_id.in_({item.id for item in category_list}))
                .order_by(CategoryAttribute.label)
            )
        )
        if category_list
        else []
    )
    attributes: dict[UUID, list[CategoryAttributeRead]] = {}
    for definition in definitions:
        attributes.setdefault(definition.category_id, []).append(
            CategoryAttributeRead.model_validate(definition)
        )
    return [
        CategoryRead(
            id=item.id,
            parent_id=item.parent_id,
            name=item.name,
            slug=item.slug,
            attributes=attributes.get(item.id, []),
        )
        for item in category_list
    ]


@router.get("/catalog/brands", response_model=list[BrandRead])
async def list_brands(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[BrandRead]:
    brands = await session.scalars(
        select(CatalogBrand).where(CatalogBrand.is_active.is_(True)).order_by(CatalogBrand.name)
    )
    return [BrandRead.model_validate(item) for item in brands]


@router.post(
    "/admin/catalog/categories",
    response_model=CategoryRead,
    status_code=201,
)
async def create_category(
    body: CategoryCreate,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CategoryRead:
    if body.parent_id is not None:
        parent = await session.get(CatalogCategory, body.parent_id)
        if parent is None or not parent.is_active:
            raise APIError(404, "category_not_found", "Parent category was not found.")
    category = CatalogCategory(name=body.name, slug=_slug(body.name), parent_id=body.parent_id)
    session.add(category)
    try:
        await session.flush()
        _audit(session, admin, "catalog_category_created", "catalog_category", category.id)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "category_conflict", "Category could not be created.") from None
    await session.refresh(category)
    return CategoryRead(
        id=category.id,
        parent_id=category.parent_id,
        name=category.name,
        slug=category.slug,
    )


@router.post(
    "/admin/catalog/categories/{category_id}/attributes",
    response_model=CategoryAttributeRead,
    status_code=201,
)
async def create_category_attribute(
    category_id: UUID,
    body: CategoryAttributeCreate,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CategoryAttributeRead:
    category = await session.get(CatalogCategory, category_id)
    if category is None:
        raise APIError(404, "category_not_found", "Category was not found.")
    attribute = CategoryAttribute(category_id=category.id, **body.model_dump())
    session.add(attribute)
    try:
        await session.flush()
        _audit(
            session,
            admin,
            "catalog_category_attribute_created",
            "catalog_category",
            category.id,
        )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409, "category_attribute_conflict", "Attribute key already exists."
        ) from None
    await session.refresh(attribute)
    return CategoryAttributeRead.model_validate(attribute)


@router.post(
    "/admin/catalog/brands",
    response_model=BrandRead,
    status_code=201,
)
async def create_brand(
    body: BrandCreate,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> BrandRead:
    brand = CatalogBrand(name=body.name, slug=_slug(body.name))
    session.add(brand)
    try:
        await session.flush()
        _audit(session, admin, "catalog_brand_created", "catalog_brand", brand.id)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "brand_conflict", "Brand could not be created.") from None
    await session.refresh(brand)
    return BrandRead.model_validate(brand)


@router.get("/catalog/products", response_model=ProductPage)
async def list_products(
    session: Annotated[AsyncSession, Depends(get_session)],
    q: Annotated[str | None, Query(max_length=120)] = None,
    category_id: UUID | None = None,
    brand_id: UUID | None = None,
    shop_id: UUID | None = None,
    city: Annotated[str | None, Query(max_length=80)] = None,
    province: Annotated[str | None, Query(max_length=80)] = None,
    min_price: Annotated[Decimal | None, Query(ge=0, max_digits=12, decimal_places=2)] = None,
    max_price: Annotated[Decimal | None, Query(ge=0, max_digits=12, decimal_places=2)] = None,
    in_stock: bool = False,
    sort: Annotated[str, Query(pattern="^(newest|price_asc|price_desc|name)$")] = "newest",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
) -> ProductPage:
    if min_price is not None and max_price is not None and min_price > max_price:
        raise APIError(422, "invalid_price_range", "min_price cannot exceed max_price.")
    query = (
        select(Product)
        .join(Shop, Shop.id == Product.shop_id)
        .join(CatalogCategory, CatalogCategory.id == Product.category_id)
        .outerjoin(CatalogBrand, CatalogBrand.id == Product.brand_id)
        .where(
            Product.status == "approved",
            Shop.is_active.is_(True),
            CatalogCategory.is_active.is_(True),
        )
    )
    if q and q.strip():
        search = f"%{q.strip()}%"
        query = query.where(
            or_(
                Product.name.ilike(search),
                Product.description.ilike(search),
                Product.sku.ilike(search),
                Shop.name.ilike(search),
                CatalogBrand.name.ilike(search),
            )
        )
    if category_id:
        query = query.where(Product.category_id == category_id)
    if brand_id:
        query = query.where(Product.brand_id == brand_id)
    if shop_id:
        query = query.where(Product.shop_id == shop_id)
    if city:
        query = query.where(Shop.city.ilike(city.strip()))
    if province:
        query = query.where(Shop.province.ilike(province.strip()))
    if min_price is not None:
        query = query.where(Product.price >= min_price)
    if max_price is not None:
        query = query.where(Product.price <= max_price)
    if in_stock:
        stocked_variant = (
            select(ProductVariant.id)
            .where(ProductVariant.product_id == Product.id, ProductVariant.stock > 0)
            .exists()
        )
        has_variants = (
            select(ProductVariant.id).where(ProductVariant.product_id == Product.id).exists()
        )
        query = query.where(or_(and_(~has_variants, Product.stock > 0), stocked_variant))

    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    if sort == "price_asc":
        ordered_query = query.order_by(Product.price.asc(), Product.id)
    elif sort == "price_desc":
        ordered_query = query.order_by(Product.price.desc(), Product.id)
    elif sort == "name":
        ordered_query = query.order_by(Product.name.asc(), Product.id)
    else:
        ordered_query = query.order_by(Product.created_at.desc(), Product.id)
    products = list(
        await session.scalars(ordered_query.offset((page - 1) * page_size).limit(page_size))
    )
    return ProductPage(
        items=await _product_reads(session, products),
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/catalog/products/{slug}", response_model=ProductRead)
async def get_product(
    slug: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProductRead:
    product = await session.scalar(
        select(Product)
        .join(Shop, Shop.id == Product.shop_id)
        .join(CatalogCategory, CatalogCategory.id == Product.category_id)
        .where(
            Product.slug == slug,
            Product.status == "approved",
            Shop.is_active.is_(True),
            CatalogCategory.is_active.is_(True),
        )
    )
    if product is None:
        raise APIError(404, "product_not_found", "Product was not found.")
    return (await _product_reads(session, [product]))[0]


@router.get("/shops", response_model=list[ShopRead])
async def discover_shops(
    session: Annotated[AsyncSession, Depends(get_session)],
    city: Annotated[str | None, Query(max_length=80)] = None,
    province: Annotated[str | None, Query(max_length=80)] = None,
    latitude: Annotated[
        Decimal | None, Query(ge=-90, le=90, max_digits=9, decimal_places=6)
    ] = None,
    longitude: Annotated[
        Decimal | None, Query(ge=-180, le=180, max_digits=9, decimal_places=6)
    ] = None,
    radius_km: Annotated[float, Query(gt=0, le=500)] = 25,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
) -> list[ShopRead]:
    if (latitude is None) != (longitude is None):
        raise APIError(422, "invalid_location", "latitude and longitude must be provided together.")
    query = select(Shop).where(Shop.is_active.is_(True))
    if city:
        query = query.where(Shop.city.ilike(city.strip()))
    if province:
        query = query.where(Shop.province.ilike(province.strip()))
    if latitude is None or longitude is None:
        shops = list(
            await session.scalars(
                query.order_by(Shop.name).offset((page - 1) * page_size).limit(page_size)
            )
        )
        return [_shop_read(shop) for shop in shops]

    lat, lon = float(latitude), float(longitude)
    lat_delta = radius_km / 110.574
    lon_delta = radius_km / max(111.320 * math.cos(math.radians(lat)), 0.01)
    candidates = await session.scalars(
        query.where(
            Shop.latitude.is_not(None),
            Shop.longitude.is_not(None),
            Shop.latitude.between(lat - lat_delta, lat + lat_delta),
            Shop.longitude.between(lon - lon_delta, lon + lon_delta),
        )
    )
    located: list[tuple[float, Shop]] = []
    for shop in candidates:
        if shop.latitude is None or shop.longitude is None:
            continue
        shop_lat = float(shop.latitude)
        shop_lon = float(shop.longitude)
        lat1, lat2 = math.radians(lat), math.radians(shop_lat)
        delta_lat = lat2 - lat1
        delta_lon = math.radians(shop_lon - lon)
        haversine = (
            math.sin(delta_lat / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
        )
        distance = 6371 * 2 * math.asin(math.sqrt(min(1.0, haversine)))
        if distance <= radius_km:
            located.append((distance, shop))
    located.sort(key=lambda result: (result[0], result[1].name))
    start = (page - 1) * page_size
    return [
        _shop_read(shop, round(distance, 2))
        for distance, shop in located[start : start + page_size]
    ]


@router.get("/shops/{slug}", response_model=ShopRead)
async def get_shop(
    slug: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ShopRead:
    shop = await session.scalar(select(Shop).where(Shop.slug == slug, Shop.is_active.is_(True)))
    if shop is None:
        raise APIError(404, "shop_not_found", "Shop was not found.")
    return _shop_read(shop)


@router.get("/vendor/shop", response_model=ShopRead)
async def get_vendor_shop(
    shop: Annotated[Shop, Depends(get_selected_shop)],
) -> ShopRead:
    return _shop_read(shop)


@router.get("/vendor/shops", response_model=list[ShopRead])
async def list_vendor_shops(
    user: Annotated[User, Depends(get_current_vendor)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ShopRead]:
    shops = await session.scalars(
        select(Shop).where(Shop.owner_user_id == user.id).order_by(Shop.slot)
    )
    return [_shop_read(shop) for shop in shops]


@router.get("/vendor/shops/{shop_id}", response_model=ShopRead)
async def get_selected_vendor_shop(
    shop_id: UUID,
    shop: Annotated[Shop, Depends(get_selected_shop)],
) -> ShopRead:
    if shop.id != shop_id:
        raise APIError(404, "shop_not_found", "The selected shop was not found.")
    return _shop_read(shop)


@router.post("/vendor/shops", response_model=ShopRead, status_code=201)
@router.post("/vendor/shop", response_model=ShopRead, status_code=201)
async def create_vendor_shop(
    body: ShopCreate,
    user: Annotated[User, Depends(get_current_vendor)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ShopRead:
    profile = await session.scalar(
        select(VendorProfile).where(VendorProfile.user_id == user.id).with_for_update()
    )
    if profile is None:
        raise APIError(403, "approved_vendor_required", "An approved vendor profile is required.")
    slots = set(await session.scalars(select(Shop.slot).where(Shop.owner_user_id == user.id)))
    free_slots = sorted({1, 2, 3} - slots)
    if not free_slots:
        raise APIError(409, "shop_limit_reached", "A vendor can own at most three shops.")
    shop = Shop(
        owner_user_id=user.id,
        slot=free_slots[0],
        name=body.name,
        slug=_slug(body.name),
        description=body.description,
        address=body.address,
        city=body.city,
        province=body.province,
        latitude=body.latitude,
        longitude=body.longitude,
    )
    session.add(shop)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "shop_conflict", "Shop profile could not be created.") from None
    await session.refresh(shop)
    return _shop_read(shop)


@router.patch("/vendor/shop", response_model=ShopRead)
async def update_vendor_shop(
    body: ShopUpdate,
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ShopRead:
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(shop, field, value)
    if not changes:
        return _shop_read(shop)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "shop_conflict", "Shop profile could not be updated.") from None
    await session.refresh(shop)
    return _shop_read(shop)


@router.patch("/vendor/shops/{shop_id}", response_model=ShopRead)
async def update_selected_vendor_shop(
    shop_id: UUID,
    body: ShopUpdate,
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ShopRead:
    if shop.id != shop_id:
        raise APIError(404, "shop_not_found", "The selected shop was not found.")
    return await update_vendor_shop(body, shop, session)


@router.get("/vendor/products", response_model=ProductPage)
async def list_vendor_products(
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
) -> ProductPage:
    total = (
        await session.scalar(
            select(func.count()).select_from(Product).where(Product.shop_id == shop.id)
        )
        or 0
    )
    products = list(
        await session.scalars(
            select(Product)
            .where(Product.shop_id == shop.id)
            .order_by(Product.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return ProductPage(
        items=await _product_reads(session, products),
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/vendor/products", response_model=ProductRead, status_code=201)
async def create_vendor_product(
    body: ProductCreate,
    user: Annotated[User, Depends(get_current_vendor)],
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProductRead:
    category = await session.get(CatalogCategory, body.category_id)
    if category is None or not category.is_active:
        raise APIError(422, "invalid_category", "Select an active product category.")
    if body.brand_id is not None:
        brand = await session.get(CatalogBrand, body.brand_id)
        if brand is None or not brand.is_active:
            raise APIError(422, "invalid_brand", "Select an active product brand.")
    await _validate_category_attributes(session, category.id, body.attributes)
    product = Product(
        shop_id=shop.id,
        category_id=category.id,
        brand_id=body.brand_id,
        name=body.name,
        slug=_slug(body.name),
        description=body.description,
        sku=body.sku,
        price=body.price,
        stock=body.stock,
        attributes=body.attributes,
        status="pending",
    )
    session.add(product)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "product_sku_conflict", "SKU is already used by this shop.") from None
    await session.refresh(product)
    return (await _product_reads(session, [product]))[0]


@router.patch("/vendor/products/{product_id}", response_model=ProductRead)
async def update_vendor_product(
    product_id: UUID,
    body: ProductUpdate,
    user: Annotated[User, Depends(get_current_vendor)],
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProductRead:
    product = await _owned_product(session, shop, product_id)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if "brand_id" in body.model_fields_set and body.brand_id is None:
        changes["brand_id"] = None
    if not changes:
        raise APIError(422, "empty_product_update", "Provide at least one product field to update.")
    category_id = changes.get("category_id", product.category_id)
    category = await session.get(CatalogCategory, category_id)
    if category is None or not category.is_active:
        raise APIError(422, "invalid_category", "Select an active product category.")
    if "brand_id" in body.model_fields_set and body.brand_id is not None:
        brand = await session.get(CatalogBrand, body.brand_id)
        if brand is None or not brand.is_active:
            raise APIError(422, "invalid_brand", "Select an active product brand.")
    attributes = changes.get("attributes", product.attributes)
    await _validate_category_attributes(session, category.id, attributes)
    variants = await session.scalars(
        select(ProductVariant).where(ProductVariant.product_id == product.id)
    )
    for variant in variants:
        try:
            await _validate_category_attributes(
                session, category.id, variant.attributes, variant=True
            )
        except APIError as exc:
            raise APIError(
                409,
                "category_change_invalidates_variants",
                "The new category does not define the attributes used by existing variants.",
                exc.details,
            ) from None
    for field, value in changes.items():
        setattr(product, field, value)
    if set(changes) - {"stock"}:
        product.status = "pending"
        product.moderation_notes = None
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "product_sku_conflict", "SKU is already used by this shop.") from None
    await session.refresh(product)
    return (await _product_reads(session, [product]))[0]


@router.post(
    "/vendor/products/{product_id}/variants",
    response_model=ProductVariantRead,
    status_code=201,
)
async def create_product_variant(
    product_id: UUID,
    body: ProductVariantCreate,
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProductVariantRead:
    product = await _owned_product(session, shop, product_id)
    await _validate_category_attributes(session, product.category_id, body.attributes, variant=True)
    variant = ProductVariant(
        product_id=product.id,
        name=body.name,
        sku=body.sku,
        price=body.price,
        stock=body.stock,
        attributes=body.attributes,
    )
    product.status = "pending"
    product.moderation_notes = None
    session.add(variant)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "variant_sku_conflict", "Variant SKU is already used.") from None
    await session.refresh(variant)
    return ProductVariantRead.model_validate(variant)


@router.patch(
    "/vendor/products/{product_id}/variants/{variant_id}",
    response_model=ProductVariantRead,
)
async def update_product_variant(
    product_id: UUID,
    variant_id: UUID,
    body: ProductVariantUpdate,
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProductVariantRead:
    product = await _owned_product(session, shop, product_id)
    variant = await session.scalar(
        select(ProductVariant).where(
            ProductVariant.id == variant_id,
            ProductVariant.product_id == product.id,
        )
    )
    if variant is None:
        raise APIError(404, "product_variant_not_found", "Product variant was not found.")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise APIError(422, "empty_variant_update", "Provide at least one variant field to update.")
    if "attributes" in changes:
        await _validate_category_attributes(
            session, product.category_id, changes["attributes"], variant=True
        )
    for field, value in changes.items():
        setattr(variant, field, value)
    if set(changes) - {"stock"}:
        product.status = "pending"
        product.moderation_notes = None
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "variant_sku_conflict", "Variant SKU is already used.") from None
    await session.refresh(variant)
    return ProductVariantRead.model_validate(variant)


@router.delete(
    "/vendor/products/{product_id}/variants/{variant_id}",
    status_code=204,
)
async def delete_product_variant(
    product_id: UUID,
    variant_id: UUID,
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    product = await _owned_product(session, shop, product_id)
    variant = await session.scalar(
        select(ProductVariant).where(
            ProductVariant.id == variant_id,
            ProductVariant.product_id == product.id,
        )
    )
    if variant is None:
        raise APIError(404, "product_variant_not_found", "Product variant was not found.")
    product.status = "pending"
    product.moderation_notes = None
    await session.delete(variant)
    await session.commit()


async def _upload_public_image(
    file: UploadFile,
    prefix: str,
) -> tuple[str, str]:
    content_type = file.content_type or ""
    image_type = IMAGE_TYPES.get(content_type)
    if image_type is None:
        raise APIError(415, "unsupported_image_type", "Upload a JPEG, PNG, or WebP image.")
    extension, signature = image_type
    contents = await file.read(MAX_IMAGE_SIZE + 1)
    if len(contents) > MAX_IMAGE_SIZE:
        raise APIError(413, "image_too_large", "Image files must be 8 MB or smaller.")
    valid_signature = contents.startswith(signature) and (
        content_type != "image/webp" or contents[8:12] == b"WEBP"
    )
    if not valid_signature:
        raise APIError(415, "invalid_image", "The uploaded file does not match its image type.")
    object_name = f"{prefix}/{uuid4().hex}.{extension}"
    try:
        await run_in_threadpool(
            get_minio_client().put_object,
            get_settings().minio_public_bucket,
            object_name,
            BytesIO(contents),
            len(contents),
            content_type=content_type,
        )
    except (S3Error, OSError):
        logger.exception("Public catalogue image upload failed")
        raise APIError(503, "image_storage_unavailable", "Image storage is unavailable.") from None
    return object_name, content_type


@router.post(
    "/vendor/products/{product_id}/images",
    response_model=ProductImageRead,
    status_code=201,
)
async def upload_product_image(
    product_id: UUID,
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: Annotated[UploadFile, File()],
    alt_text: Annotated[str, Query(max_length=180)] = "",
) -> ProductImageRead:
    product = await _owned_product(session, shop, product_id)
    object_name, _ = await _upload_public_image(file, f"products/{product.id}")
    product.status = "pending"
    product.moderation_notes = None
    image = ProductImage(
        product_id=product.id,
        object_name=object_name,
        alt_text=alt_text.strip(),
        sort_order=int(
            await session.scalar(
                select(func.count())
                .select_from(ProductImage)
                .where(ProductImage.product_id == product.id)
            )
            or 0
        ),
    )
    session.add(image)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "product_image_conflict", "Image could not be saved.") from None
    await session.refresh(image)
    return ProductImageRead(
        id=image.id,
        url=_public_url(image.object_name),
        alt_text=image.alt_text,
        sort_order=image.sort_order,
    )


@router.post("/vendor/shop/logo", response_model=ShopRead)
async def upload_shop_logo(
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: Annotated[UploadFile, File()],
) -> ShopRead:
    object_name, _ = await _upload_public_image(file, f"shops/{shop.id}")
    previous_object_name = shop.logo_object_name
    shop.logo_object_name = object_name
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(409, "shop_logo_conflict", "Shop logo could not be saved.") from None
    await session.refresh(shop)
    if previous_object_name:
        try:
            await run_in_threadpool(
                get_minio_client().remove_object,
                get_settings().minio_public_bucket,
                previous_object_name,
            )
        except (S3Error, OSError):
            logger.exception("Previous shop logo could not be removed")
    return _shop_read(shop)


@router.get("/admin/catalog/moderation", response_model=ProductPage)
async def list_pending_products(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
) -> ProductPage:
    _ = admin
    total = (
        await session.scalar(
            select(func.count()).select_from(Product).where(Product.status == "pending")
        )
        or 0
    )
    products = list(
        await session.scalars(
            select(Product)
            .where(Product.status == "pending")
            .order_by(Product.created_at)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return ProductPage(
        items=await _product_reads(session, products),
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/admin/catalog/products/{product_id}/moderation", response_model=ProductRead)
async def moderate_product(
    product_id: UUID,
    body: ProductModerationDecision,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProductRead:
    product = await session.get(Product, product_id)
    if product is None:
        raise APIError(404, "product_not_found", "Product was not found.")
    if product.status != "pending":
        raise APIError(409, "product_already_reviewed", "Only pending listings can be reviewed.")
    shop = await session.get(Shop, product.shop_id)
    if shop is None or not shop.is_active:
        raise APIError(409, "shop_unavailable", "The listing's shop is not active.")
    product.status = body.status
    product.moderation_notes = body.notes
    _audit(
        session,
        admin,
        f"catalog_product_{body.status}",
        "catalog_product",
        product.id,
        body.notes,
    )
    await session.commit()
    await session.refresh(product)
    return (await _product_reads(session, [product]))[0]


@router.get("/me/wishlist", response_model=list[ProductRead])
async def list_wishlist(
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ProductRead]:
    product_ids = await session.scalars(
        select(WishlistItem.product_id)
        .join(Product, Product.id == WishlistItem.product_id)
        .join(Shop, Shop.id == Product.shop_id)
        .where(
            WishlistItem.user_id == user.id,
            Product.status == "approved",
            Shop.is_active.is_(True),
        )
        .order_by(WishlistItem.created_at.desc())
    )
    saved_product_ids = list(product_ids)
    products = list(
        await session.scalars(
            select(Product).where(Product.id.in_(saved_product_ids))
            if saved_product_ids
            else select(Product).where(Product.id.is_(None))
        )
    )
    products_by_id = {product.id: product for product in products}
    ordered_products = [
        products_by_id[product_id]
        for product_id in saved_product_ids
        if product_id in products_by_id
    ]
    return await _product_reads(session, ordered_products)


@router.post("/me/wishlist/{product_id}", status_code=204)
async def add_wishlist_item(
    product_id: UUID,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    product = await session.scalar(
        select(Product)
        .join(Shop, Shop.id == Product.shop_id)
        .where(
            Product.id == product_id,
            Product.status == "approved",
            Shop.is_active.is_(True),
        )
    )
    if product is None:
        raise APIError(404, "product_not_found", "Product was not found.")
    existing = await session.scalar(
        select(WishlistItem.id).where(
            WishlistItem.user_id == user.id,
            WishlistItem.product_id == product.id,
        )
    )
    if existing is not None:
        return
    session.add(WishlistItem(user_id=user.id, product_id=product.id))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(
            select(WishlistItem.id).where(
                WishlistItem.user_id == user.id,
                WishlistItem.product_id == product.id,
            )
        )
        if existing is None:
            raise APIError(
                409, "wishlist_update_failed", "Wishlist item could not be saved."
            ) from None


@router.delete("/me/wishlist/{product_id}", status_code=204)
async def remove_wishlist_item(
    product_id: UUID,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    item = await session.scalar(
        select(WishlistItem).where(
            WishlistItem.user_id == user.id,
            WishlistItem.product_id == product_id,
        )
    )
    if item is None:
        raise APIError(404, "wishlist_item_not_found", "Wishlist item was not found.")
    await session.delete(item)
    await session.commit()
