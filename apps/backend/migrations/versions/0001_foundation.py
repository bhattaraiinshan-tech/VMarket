"""Record the initial database schema baseline.

Revision ID: 0001_foundation
Revises:
Create Date: 2026-11-03
"""

revision: str = "0001_foundation"
down_revision: str | None = None
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
