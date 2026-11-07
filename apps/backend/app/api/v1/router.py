from fastapi import APIRouter

from app.api.v1.health import router as health_router
from app.catalog.router import router as catalog_router
from app.communications.router import router as communications_router
from app.identity.router import router as identity_router
from app.operations.router import router as operations_router
from app.orders.router import router as orders_router
from app.trading.router import router as trading_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(catalog_router)
api_router.include_router(identity_router)
api_router.include_router(orders_router)
api_router.include_router(communications_router)
api_router.include_router(trading_router)
api_router.include_router(operations_router)
