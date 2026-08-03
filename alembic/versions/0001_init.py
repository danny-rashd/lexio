"""init

Revision ID: 0001_init
Revises:
Create Date: 2026-08-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0001_init'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(), nullable=False),
        sa.Column('hashed_password', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username'),
    )
    op.create_table(
        'decks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('category', sa.String(), nullable=False),
        sa.Column('subject', sa.String(), nullable=False),
        sa.Column('topic', sa.String(), nullable=False),
        sa.Column('question_template_forward', sa.String(), nullable=True),
        sa.Column('question_template_reverse', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.CheckConstraint("category IN ('language','general')", name='ck_decks_category'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('category', 'subject', 'topic', name='uq_decks_category_subject_topic'),
    )
    op.create_index('idx_decks_subject', 'decks', ['subject'], unique=False)
    op.create_table(
        'study_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('study_date', sa.Date(), nullable=False),
        sa.Column('sessions', sa.Integer(), nullable=False),
        sa.Column('cards_seen', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'study_date', name='uq_study_log_user_date'),
    )
    op.create_table(
        'user_settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('value', sa.String(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'key', name='uq_user_settings_user_key'),
    )
    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('endpoint', sa.String(), nullable=False),
        sa.Column('p256dh', sa.String(), nullable=False),
        sa.Column('auth', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('endpoint'),
    )
    op.create_table(
        'essay_submissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('language', sa.String(), nullable=False),
        sa.Column('text', sa.String(), nullable=False),
        sa.Column('word_count', sa.Integer(), nullable=False),
        sa.Column('overall_score', sa.Float(), nullable=False),
        sa.Column('evaluation', sa.String(), nullable=False),
        sa.Column('submitted_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'immersion_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('language', sa.String(), nullable=False),
        sa.Column('activity_type', sa.String(), nullable=False),
        sa.Column('resource', sa.String(), nullable=True),
        sa.Column('resource_type', sa.String(), nullable=True),
        sa.Column('resource_creator', sa.String(), nullable=True),
        sa.Column('resource_detail', sa.String(), nullable=True),
        sa.Column('resource_url', sa.String(), nullable=True),
        sa.Column('duration_minutes', sa.Integer(), nullable=False),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('rating', sa.Integer(), nullable=True),
        sa.Column('logged_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.CheckConstraint("activity_type IN ('reading','listening','watching','speaking','writing','gaming','other')", name='ck_immersion_activity_type'),
        sa.CheckConstraint("resource_type IS NULL OR resource_type IN ('podcast','tv_show','movie','music','video','book','app','other')", name='ck_immersion_resource_type'),
        sa.CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name='ck_immersion_rating'),
        sa.CheckConstraint("duration_minutes > 0", name='ck_immersion_duration'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'cards',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('term', sa.String(), nullable=False),
        sa.Column('definition', sa.String(), nullable=False),
        sa.Column('native', sa.String(), nullable=True),
        sa.Column('sentence', sa.String(), nullable=True),
        sa.Column('ipa', sa.String(), nullable=True),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('idempotency_key', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('source_log_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['deck_id'], ['decks.id'], ),
        sa.ForeignKeyConstraint(['source_log_id'], ['immersion_logs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('idempotency_key'),
    )
    op.create_index('idx_cards_deck', 'cards', ['deck_id'], unique=False)
    op.create_index('idx_cards_key', 'cards', ['idempotency_key'], unique=False)
    op.create_table(
        'import_batches',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('deck_id', sa.Integer(), nullable=False),
        sa.Column('source_file', sa.String(), nullable=False),
        sa.Column('rows_parsed', sa.Integer(), nullable=True),
        sa.Column('rows_inserted', sa.Integer(), nullable=True),
        sa.Column('rows_skipped', sa.Integer(), nullable=True),
        sa.Column('imported_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['deck_id'], ['decks.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'conjugations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('data', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['card_id'], ['cards.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('card_id', name='uq_conjugations_card_id'),
    )
    op.create_table(
        'quiz_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('mode', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('deck_id', sa.Integer(), nullable=True),
        sa.Column('direction', sa.String(), nullable=False),
        sa.Column('total', sa.Integer(), nullable=False),
        sa.Column('correct', sa.Integer(), nullable=False),
        sa.Column('card_ids_filter', sa.String(), nullable=True),
        sa.Column('started_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.CheckConstraint("direction IN ('1_only','2_only','3_only','4_only','1_and_2','all_available','random')", name='ck_quiz_sessions_direction'),
        sa.CheckConstraint("mode IN ('mcq','typing','flashcard','cloze')", name='ck_quiz_sessions_mode'),
        sa.CheckConstraint("scope IN ('test','big_test','review')", name='ck_quiz_sessions_scope'),
        sa.ForeignKeyConstraint(['deck_id'], ['decks.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'card_stats',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('direction', sa.String(), nullable=False),
        sa.Column('times_seen', sa.Integer(), nullable=False),
        sa.Column('times_correct', sa.Integer(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), nullable=True),
        sa.Column('srs_interval', sa.Integer(), nullable=False),
        sa.Column('srs_ease_factor', sa.Float(), nullable=False),
        sa.Column('srs_due_date', sa.Date(), nullable=True),
        sa.Column('srs_repetitions', sa.Integer(), nullable=False),
        sa.CheckConstraint("direction IN ('word_to_meaning','meaning_to_word','native_to_meaning','native_to_word')", name='ck_card_stats_direction'),
        sa.ForeignKeyConstraint(['card_id'], ['cards.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'card_id', 'direction', name='uq_card_stats_user_card_direction'),
    )
    op.create_index('idx_card_stats_card', 'card_stats', ['card_id'], unique=False)
    op.create_index('idx_card_stats_user', 'card_stats', ['user_id'], unique=False)
    op.create_index('idx_card_stats_due', 'card_stats', ['srs_due_date'], unique=False)
    op.create_table(
        'quiz_answers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('direction', sa.String(), nullable=False),
        sa.Column('user_answer', sa.String(), nullable=True),
        sa.Column('correct_answer', sa.String(), nullable=False),
        sa.Column('is_correct', sa.Boolean(), nullable=False),
        sa.Column('answered_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.CheckConstraint("direction IN ('word_to_meaning','meaning_to_word','native_to_meaning','native_to_word')", name='ck_quiz_answers_direction'),
        sa.ForeignKeyConstraint(['card_id'], ['cards.id'], ),
        sa.ForeignKeyConstraint(['session_id'], ['quiz_sessions.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('quiz_answers')
    op.drop_index('idx_card_stats_due', table_name='card_stats')
    op.drop_index('idx_card_stats_user', table_name='card_stats')
    op.drop_index('idx_card_stats_card', table_name='card_stats')
    op.drop_table('card_stats')
    op.drop_table('quiz_sessions')
    op.drop_table('conjugations')
    op.drop_table('import_batches')
    op.drop_index('idx_cards_key', table_name='cards')
    op.drop_index('idx_cards_deck', table_name='cards')
    op.drop_table('cards')
    op.drop_table('immersion_logs')
    op.drop_table('essay_submissions')
    op.drop_table('push_subscriptions')
    op.drop_table('user_settings')
    op.drop_table('study_logs')
    op.drop_index('idx_decks_subject', table_name='decks')
    op.drop_table('decks')
    op.drop_table('users')
