using CvBuilder.Api.Models;
using CvBuilder.Api.Templates;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 20 * 1024 * 1024;
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("LocalReact", policy => policy
        .WithOrigins("http://localhost:5173", "https://localhost:5173")
        .AllowAnyHeader()
        .AllowAnyMethod());
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSingleton<TemplateRegistry>();

var app = builder.Build();

app.UseCors("LocalReact");

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/templates", (TemplateRegistry registry) =>
{
    return Results.Ok(registry.GetTemplates().Select(t => new
    {
        id = t.Id,
        name = t.Name,
        description = t.Description
    }));
});

app.MapPost("/api/pdf/{templateId}", (string templateId, CvDocument document, TemplateRegistry registry) =>
{
    var template = registry.Find(templateId);
    if (template is null)
        return Results.NotFound(new { message = $"Template '{templateId}' finnes ikke." });

    var pdfBytes = template.Render(document);
    var fileName = $"{Slug.Create(document.Profile.FullName)}-{DateTimeOffset.Now:yyyyMMdd-HHmm}.pdf";

    return Results.File(pdfBytes, "application/pdf", fileName);
});

app.Run();

internal static class Slug
{
    public static string Create(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "cv";

        var chars = value.Trim().ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) ? c : '-')
            .ToArray();

        var result = new string(chars);
        while (result.Contains("--", StringComparison.Ordinal))
            result = result.Replace("--", "-", StringComparison.Ordinal);

        return result.Trim('-');
    }
}
