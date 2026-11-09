package com.dbviewer.app.sql;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unique constraints, secondary indexes and CHECKs in an imported dump.
 *
 * <p>They used to be dropped with a note, so an imported schema lost every index it had and
 * a 1:1 relationship (a unique foreign key) arrived looking like a 1:N.
 */
class ConstraintTranslationTest {

    private static String joined(SqlDialectTranslator.Result result) {
        return String.join(";\n", result.statements());
    }

    @Test
    void mysqlInlineUniqueKeyAndCheckAreKept() {
        SqlDialectTranslator.Result result = SqlDialectTranslator.translate(List.of("""
                CREATE TABLE `users` (
                  `id` int NOT NULL AUTO_INCREMENT,
                  `email` varchar(255) NOT NULL,
                  `name` varchar(100),
                  PRIMARY KEY (`id`),
                  UNIQUE KEY `uq_email` (`email`),
                  KEY `idx_name` (`name`(20) DESC),
                  CONSTRAINT `chk_name` CHECK (length(`name`) > 0)
                ) ENGINE=InnoDB"""), SqlDialect.MYSQL);
        String sql = joined(result);

        assertThat(sql).contains("UNIQUE (\"email\")");
        assertThat(sql).contains("CHECK (length(\"name\") > 0)");
        assertThat(sql).contains("CREATE INDEX IF NOT EXISTS \"users_idx_name\" ON \"users\" (\"name\" DESC)");
    }

    @Test
    void pgDumpAlterTableUniqueAndCheckAreFoldedIn() {
        SqlDialectTranslator.Result result = SqlDialectTranslator.translate(List.of(
                "CREATE TABLE public.items (id integer NOT NULL, sku text, price numeric)",
                "ALTER TABLE ONLY public.items ADD CONSTRAINT items_sku_key UNIQUE (sku)",
                "ALTER TABLE ONLY public.items ADD CONSTRAINT items_price_check CHECK ((price > (0)::numeric))"),
                SqlDialect.POSTGRES);
        String sql = joined(result);

        assertThat(sql).contains("UNIQUE (\"sku\")");
        assertThat(sql).contains("CHECK ((price > (0)))");
    }

    @Test
    void sqlServerBracketedConstraintsAreRewritten() {
        SqlDialectTranslator.Result result = SqlDialectTranslator.translate(List.of(
                "CREATE TABLE [dbo].[Products] ([Id] int NOT NULL, [Code] nvarchar(20), [Qty] int)",
                "ALTER TABLE [dbo].[Products] ADD CONSTRAINT [UQ_Code] UNIQUE NONCLUSTERED ([Code] ASC)",
                "ALTER TABLE [dbo].[Products] WITH CHECK ADD CONSTRAINT [CK_Qty] CHECK (([Qty]>=(0)))"),
                SqlDialect.SQLSERVER);
        String sql = joined(result);

        assertThat(sql).contains("UNIQUE (\"Code\" ASC)");
        assertThat(sql).contains("CHECK ((\"Qty\">=(0)))");
    }

    /** One unknown function would fail the whole CREATE TABLE, losing the table, not the check. */
    @Test
    void aCheckSqliteCannotEvaluateIsDroppedWithANote() {
        SqlDialectTranslator.Result result = SqlDialectTranslator.translate(List.of("""
                CREATE TABLE t (code text, CONSTRAINT c CHECK (code ~ '^[A-Z]+$'),
                                CHECK (char_length(code) < 10))"""), SqlDialect.POSTGRES);

        assertThat(joined(result)).doesNotContain("CHECK");
        assertThat(result.notes()).filteredOn(n -> n.contains("cannot evaluate")).hasSize(2);
    }

    @Test
    void anExpressionIndexIsSkippedRatherThanBroken() {
        assertThat(SqlDialectTranslator.indexColumns("lower(email)")).isNull();
        assertThat(SqlDialectTranslator.indexColumns("`a`, b DESC")).containsExactly("\"a\"", "\"b\" DESC");
        assertThat(SqlDialectTranslator.portableCheck("`qty` BETWEEN 1 AND 10")).isEqualTo("\"qty\" BETWEEN 1 AND 10");
    }
}
